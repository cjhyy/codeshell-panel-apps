import { selectObservation } from "./market-contract.mjs";

const DAY_MS = 86_400_000;
const EVENT_TYPES = new Set([
  "buy",
  "sell",
  "cash-in",
  "cash-out",
  "position-in",
  "position-out",
  "dividend",
  "dividend-tax-adjustment",
  "split",
  "stock-dividend",
  "fx-conversion",
  "cash-transfer",
  "position-transfer",
  "reorganization",
]);
const CURRENCIES = new Set(["CNY", "USD"]);
const POW10 = [1n];

function pow10(exponent) {
  while (POW10.length <= exponent) POW10.push(POW10.at(-1) * 10n);
  return POW10[exponent];
}

function dec(coefficient = 0n, scale = 0) {
  let nextCoefficient = coefficient;
  let nextScale = scale;
  while (nextScale > 0 && nextCoefficient % 10n === 0n) {
    nextCoefficient /= 10n;
    nextScale -= 1;
  }
  return { coefficient: nextCoefficient, scale: nextScale };
}

const ZERO = dec();
const ONE = dec(1n);

function parseDecimal(value, path, options = {}) {
  if (typeof value !== "string") {
    throw new DecimalIssue(path, "decimal-string-required", "must be a decimal string");
  }
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(value);
  if (!match) throw new DecimalIssue(path, "invalid-decimal", "must be a canonical decimal");
  const fraction = match[3] ?? "";
  if (fraction.length > (options.maxScale ?? 12)) {
    throw new DecimalIssue(path, "precision-exceeded", "has too many decimal places");
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const result = dec(sign * BigInt(`${match[2]}${fraction}`), fraction.length);
  if (options.positive && result.coefficient <= 0n) {
    throw new DecimalIssue(path, "positive-required", "must be positive");
  }
  if (options.nonNegative && result.coefficient < 0n) {
    throw new DecimalIssue(path, "non-negative-required", "must be non-negative");
  }
  return result;
}

class DecimalIssue extends Error {
  constructor(path, code, message) {
    super(message);
    this.path = path;
    this.code = code;
  }
}

function align(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.coefficient * pow10(scale - left.scale),
    right.coefficient * pow10(scale - right.scale),
    scale,
  ];
}

function add(left, right) {
  const [a, b, scale] = align(left, right);
  return dec(a + b, scale);
}

function subtract(left, right) {
  return add(left, dec(-right.coefficient, right.scale));
}

function multiply(left, right) {
  return dec(left.coefficient * right.coefficient, left.scale + right.scale);
}

function compare(left, right) {
  const [a, b] = align(left, right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function roundDivide(numerator, denominator) {
  if (denominator <= 0n) throw new Error("roundDivide denominator must be positive");
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  let quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  const doubled = remainder * 2n;
  if (doubled > denominator || (doubled === denominator && quotient % 2n !== 0n)) quotient += 1n;
  return negative ? -quotient : quotient;
}

function proportionalMoney(amount, part, total) {
  if (total.coefficient <= 0n) throw new Error("total quantity must be positive");
  const numerator =
    amount.coefficient * part.coefficient * pow10(total.scale) * pow10(2);
  const denominator = pow10(amount.scale + part.scale) * total.coefficient;
  return dec(roundDivide(numerator, denominator), 2);
}

function decimalString(value) {
  const negative = value.coefficient < 0n;
  const digits = (negative ? -value.coefficient : value.coefficient).toString();
  if (value.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(value.scale + 1, "0");
  return `${negative ? "-" : ""}${padded.slice(0, -value.scale)}.${padded.slice(-value.scale)}`;
}

function moneyString(value) {
  const cents =
    value.scale <= 2
      ? value.coefficient * pow10(2 - value.scale)
      : roundDivide(value.coefficient, pow10(value.scale - 2));
  const negative = cents < 0n;
  const digits = (negative ? -cents : cents).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

function decimalNumber(value) {
  return Number(decimalString(value));
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const instant = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
}

function addDays(value, days) {
  const instant = new Date(`${value}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function fingerprintText(value) {
  let hash = 2_166_136_261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function plainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

// Derivation inputs (checkpoint FX, ending date/prices) change the holdings
// snapshot without any ledger edit; the cache pins them alongside the ledger.
export function fingerprintInputs(inputs = {}) {
  return fingerprintText(stableJson(plainObject(inputs) ? inputs : {}));
}

function unknownFields(value, allowed, path, issues) {
  if (!plainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push({ path: `${path}.${key}`, code: "unknown-field", message: "unknown field" });
    }
  }
}

function required(value, fields, path, issues) {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      issues.push({ path: `${path}.${field}`, code: "required", message: "field is required" });
    }
  }
}

function validateDecimalField(value, field, path, issues, options) {
  if (!Object.prototype.hasOwnProperty.call(value, field)) return null;
  try {
    return parseDecimal(value[field], `${path}.${field}`, options);
  } catch (error) {
    if (error instanceof DecimalIssue) {
      issues.push({ path: error.path, code: error.code, message: error.message });
      return null;
    }
    throw error;
  }
}

function validateDateField(value, field, path, issues) {
  if (!Object.prototype.hasOwnProperty.call(value, field)) return;
  if (!validDate(value[field])) {
    issues.push({ path: `${path}.${field}`, code: "invalid-date", message: "invalid calendar date" });
  }
}

function validateInstantField(value, field, path, issues) {
  if (!Object.prototype.hasOwnProperty.call(value, field)) return;
  if (typeof value[field] !== "string" || Number.isNaN(Date.parse(value[field]))) {
    issues.push({ path: `${path}.${field}`, code: "invalid-instant", message: "invalid timestamp" });
  }
}

export class PortfolioValidationError extends Error {
  constructor(issues) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "PortfolioValidationError";
    this.issues = issues;
  }
}

const ROOT_FIELDS = new Set([
  "format",
  "version",
  "baseCurrency",
  "accounts",
  "instruments",
  "transactions",
]);
const ACCOUNT_FIELDS = new Set(["id", "name", "broker", "currencies"]);
const INSTRUMENT_FIELDS = new Set([
  "id",
  "type",
  "market",
  "currency",
  "symbol",
  "name",
  "aliases",
]);
const COMMON_TRANSACTION_FIELDS = ["id", "type", "createdAt"];
const TRANSACTION_FIELDS = {
  buy: ["accountId", "instrumentId", "tradeDate", "quantity", "price", "commission", "tax", "otherFees"],
  sell: ["accountId", "instrumentId", "tradeDate", "quantity", "price", "commission", "tax", "otherFees"],
  "cash-in": ["accountId", "currency", "amount", "valuationDate", "timing"],
  "cash-out": ["accountId", "currency", "amount", "valuationDate", "timing"],
  "position-in": ["accountId", "instrumentId", "quantity", "valuationDate", "timing", "fairValueBase", "costBasisLocal", "costBasisBase"],
  "position-out": ["accountId", "instrumentId", "quantity", "valuationDate", "timing", "fairValueBase", "costBasisLocal", "costBasisBase"],
  dividend: ["accountId", "instrumentId", "exDate", "payDate", "gross", "withholding", "net"],
  "dividend-tax-adjustment": ["accountId", "dividendTransactionId", "effectiveDate", "currency", "amount"],
  split: ["accountId", "instrumentId", "effectiveDate", "factor"],
  "stock-dividend": ["accountId", "instrumentId", "effectiveDate", "factor"],
  "fx-conversion": ["accountId", "effectiveDate", "fromCurrency", "fromAmount", "toCurrency", "toAmount", "feeCurrency", "fee"],
  "cash-transfer": ["fromAccountId", "toAccountId", "effectiveDate", "currency", "amount"],
  "position-transfer": ["fromAccountId", "toAccountId", "effectiveDate", "instrumentId", "quantity", "carriedCostBasisLocal", "carriedCostBasisBase"],
  reorganization: ["accountId", "effectiveDate", "fromInstrumentId", "shareFactor", "cashConsideration", "basisAllocationToNew"],
};

function transactionInstrumentId(transaction) {
  return transaction.instrumentId ?? transaction.fromInstrumentId ?? null;
}

export function parseTransactions(sourceText) {
  const issues = [];
  if (typeof sourceText !== "string") {
    throw new PortfolioValidationError([
      { path: "$", code: "text-required", message: "ledger source must be text" },
    ]);
  }
  let ledger;
  try {
    ledger = JSON.parse(sourceText);
  } catch {
    throw new PortfolioValidationError([
      { path: "$", code: "invalid-json", message: "ledger is not valid JSON" },
    ]);
  }
  if (!plainObject(ledger)) {
    throw new PortfolioValidationError([
      { path: "$", code: "object-required", message: "ledger must be an object" },
    ]);
  }
  unknownFields(ledger, ROOT_FIELDS, "$", issues);
  required(ledger, [...ROOT_FIELDS], "", issues);
  if (ledger.format !== "codeshell.portfolio-transactions") {
    issues.push({ path: "format", code: "invalid-format", message: "unexpected ledger format" });
  }
  if (ledger.version !== 1) {
    issues.push({ path: "version", code: "unsupported-version", message: "only version 1 is supported" });
  }
  if (ledger.baseCurrency !== "CNY") {
    issues.push({ path: "baseCurrency", code: "unsupported-base-currency", message: "base currency must be CNY" });
  }
  if (!Array.isArray(ledger.accounts)) {
    issues.push({ path: "accounts", code: "array-required", message: "accounts must be an array" });
    ledger.accounts = [];
  }
  if (!Array.isArray(ledger.instruments)) {
    issues.push({ path: "instruments", code: "array-required", message: "instruments must be an array" });
    ledger.instruments = [];
  }
  if (!Array.isArray(ledger.transactions)) {
    issues.push({ path: "transactions", code: "array-required", message: "transactions must be an array" });
    ledger.transactions = [];
  }

  const globalIds = new Set();
  const accountIds = new Set();
  for (const [index, account] of ledger.accounts.entries()) {
    const path = `accounts[${index}]`;
    if (!plainObject(account)) {
      issues.push({ path, code: "object-required", message: "account must be an object" });
      continue;
    }
    unknownFields(account, ACCOUNT_FIELDS, path, issues);
    required(account, [...ACCOUNT_FIELDS], path, issues);
    if (typeof account.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(account.id)) {
      issues.push({ path: `${path}.id`, code: "invalid-id", message: "invalid account id" });
    } else if (globalIds.has(account.id)) {
      issues.push({ path: `${path}.id`, code: "duplicate-id", message: "id must be globally unique" });
    } else {
      globalIds.add(account.id);
      accountIds.add(account.id);
    }
    for (const field of ["name", "broker"]) {
      if (typeof account[field] !== "string" || account[field].length === 0) {
        issues.push({ path: `${path}.${field}`, code: "non-empty-string-required", message: "must be a non-empty string" });
      }
    }
    if (!Array.isArray(account.currencies) || account.currencies.length === 0) {
      issues.push({ path: `${path}.currencies`, code: "currency-list-required", message: "at least one currency is required" });
    } else {
      const seen = new Set();
      for (const [currencyIndex, currency] of account.currencies.entries()) {
        if (!CURRENCIES.has(currency)) {
          issues.push({ path: `${path}.currencies[${currencyIndex}]`, code: "unsupported-currency", message: "currency is unsupported" });
        } else if (seen.has(currency)) {
          issues.push({ path: `${path}.currencies[${currencyIndex}]`, code: "duplicate-currency", message: "currency is duplicated" });
        }
        seen.add(currency);
      }
    }
  }

  const instrumentIds = new Set();
  const instrumentById = new Map();
  for (const [index, instrument] of ledger.instruments.entries()) {
    const path = `instruments[${index}]`;
    if (!plainObject(instrument)) {
      issues.push({ path, code: "object-required", message: "instrument must be an object" });
      continue;
    }
    unknownFields(instrument, INSTRUMENT_FIELDS, path, issues);
    required(instrument, [...INSTRUMENT_FIELDS], path, issues);
    if (typeof instrument.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(instrument.id)) {
      issues.push({ path: `${path}.id`, code: "invalid-id", message: "invalid instrument id" });
    } else if (globalIds.has(instrument.id)) {
      issues.push({ path: `${path}.id`, code: "duplicate-id", message: "id must be globally unique" });
    } else {
      globalIds.add(instrument.id);
      instrumentIds.add(instrument.id);
      instrumentById.set(instrument.id, instrument);
    }
    if (instrument.type !== "stock") {
      issues.push({ path: `${path}.type`, code: "unsupported-instrument-type", message: "only stock is supported" });
    }
    if (instrument.market !== "cn" && instrument.market !== "us") {
      issues.push({ path: `${path}.market`, code: "unsupported-market", message: "only cn and us markets are supported" });
    }
    if (!CURRENCIES.has(instrument.currency)) {
      issues.push({ path: `${path}.currency`, code: "unsupported-currency", message: "currency is unsupported" });
    }
    if (instrument.market === "cn" && instrument.currency !== "CNY") {
      issues.push({ path: `${path}.currency`, code: "market-currency-mismatch", message: "cn stocks must use CNY" });
    }
    if (instrument.market === "us" && instrument.currency !== "USD") {
      issues.push({ path: `${path}.currency`, code: "market-currency-mismatch", message: "us stocks must use USD" });
    }
    const symbolValid =
      instrument.market === "cn"
        ? /^(?:SH|SZ)\d{6}$/u.test(instrument.symbol)
        : /^[A-Z][A-Z0-9.-]{0,9}$/u.test(instrument.symbol);
    if (!symbolValid) {
      issues.push({ path: `${path}.symbol`, code: "invalid-symbol", message: "symbol is not canonical for its market" });
    }
    if (typeof instrument.name !== "string" || instrument.name.length === 0) {
      issues.push({ path: `${path}.name`, code: "non-empty-string-required", message: "name is required" });
    }
    if (!Array.isArray(instrument.aliases) || instrument.aliases.some((alias) => typeof alias !== "string")) {
      issues.push({ path: `${path}.aliases`, code: "string-array-required", message: "aliases must be strings" });
    }
  }

  const dividendIds = new Set();
  for (const [index, transaction] of ledger.transactions.entries()) {
    const path = `transactions[${index}]`;
    if (!plainObject(transaction)) {
      issues.push({ path, code: "object-required", message: "transaction must be an object" });
      continue;
    }
    const type = transaction.type;
    const typeFields = TRANSACTION_FIELDS[type];
    if (!EVENT_TYPES.has(type) || !typeFields) {
      issues.push({ path: `${path}.type`, code: "unknown-event", message: "event type is unsupported" });
      unknownFields(transaction, new Set([...COMMON_TRANSACTION_FIELDS]), path, issues);
      continue;
    }
    const allowed = new Set([...COMMON_TRANSACTION_FIELDS, ...typeFields]);
    if (type === "reorganization") allowed.add("toInstrumentId");
    if (type === "position-in") allowed.add("source");
    unknownFields(transaction, allowed, path, issues);
    required(transaction, ["id", "type", ...typeFields], path, issues);
    if (transaction.source !== undefined) {
      const source = transaction.source;
      const sourcePath = `${path}.source`;
      if (!plainObject(source)) {
        issues.push({ path: sourcePath, code: "invalid-source", message: "holding source must be an object" });
      } else {
        const fields = new Set(["kind", "reference", "marketDate", "importId"]);
        unknownFields(source, fields, sourcePath, issues);
        required(source, [...fields], sourcePath, issues);
        if (source.kind !== "holding-snapshot" || typeof source.reference !== "string" ||
            !source.reference.trim() || source.reference.length > 500 ||
            !/^[a-f0-9]{64}$/u.test(source.importId ?? "") ||
            (source.marketDate !== null && !validDate(source.marketDate))) {
          issues.push({ path: sourcePath, code: "invalid-source", message: "holding source identity/date is invalid" });
        }
      }
    }

    if (typeof transaction.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(transaction.id)) {
      issues.push({ path: `${path}.id`, code: "invalid-id", message: "invalid transaction id" });
    } else if (globalIds.has(transaction.id)) {
      issues.push({ path: `${path}.id`, code: "duplicate-id", message: "id must be globally unique" });
    } else {
      globalIds.add(transaction.id);
      if (type === "dividend") dividendIds.add(transaction.id);
    }
    validateInstantField(transaction, "createdAt", path, issues);
    for (const field of ["tradeDate", "valuationDate", "effectiveDate", "exDate", "payDate"]) {
      validateDateField(transaction, field, path, issues);
    }
    if (validDate(transaction.exDate) && validDate(transaction.payDate) && transaction.payDate < transaction.exDate) {
      issues.push({ path: `${path}.payDate`, code: "date-order", message: "payDate cannot precede exDate" });
    }
    for (const field of ["accountId", "fromAccountId", "toAccountId"]) {
      if (Object.prototype.hasOwnProperty.call(transaction, field) && !accountIds.has(transaction[field])) {
        issues.push({ path: `${path}.${field}`, code: "broken-reference", message: "account does not exist" });
      }
    }
    for (const field of ["instrumentId", "fromInstrumentId", "toInstrumentId"]) {
      if (Object.prototype.hasOwnProperty.call(transaction, field) && !instrumentIds.has(transaction[field])) {
        issues.push({ path: `${path}.${field}`, code: "broken-reference", message: "instrument does not exist" });
      }
    }
    if (transaction.fromAccountId && transaction.fromAccountId === transaction.toAccountId) {
      issues.push({ path: `${path}.toAccountId`, code: "same-account-transfer", message: "transfer accounts must differ" });
    }
    const account = ledger.accounts.find((candidate) => candidate.id === transaction.accountId);
    const instrument = instrumentById.get(transactionInstrumentId(transaction));
    if (account && instrument && !account.currencies.includes(instrument.currency)) {
      issues.push({ path: `${path}.accountId`, code: "account-currency-mismatch", message: "account does not support instrument currency" });
    }
    if (account) {
      for (const field of ["currency", "fromCurrency", "toCurrency", "feeCurrency"]) {
        if (
          Object.prototype.hasOwnProperty.call(transaction, field) &&
          CURRENCIES.has(transaction[field]) &&
          !account.currencies.includes(transaction[field])
        ) {
          issues.push({ path: `${path}.${field}`, code: "account-currency-mismatch", message: "account does not support currency" });
        }
      }
    }
    if (transaction.type === "cash-transfer" && CURRENCIES.has(transaction.currency)) {
      for (const field of ["fromAccountId", "toAccountId"]) {
        const transferAccount = ledger.accounts.find((candidate) => candidate.id === transaction[field]);
        if (transferAccount && !transferAccount.currencies.includes(transaction.currency)) {
          issues.push({ path: `${path}.${field}`, code: "account-currency-mismatch", message: "account does not support transfer currency" });
        }
      }
    }
    if (transaction.type === "position-transfer" && instrument) {
      for (const field of ["fromAccountId", "toAccountId"]) {
        const transferAccount = ledger.accounts.find((candidate) => candidate.id === transaction[field]);
        if (transferAccount && !transferAccount.currencies.includes(instrument.currency)) {
          issues.push({ path: `${path}.${field}`, code: "account-currency-mismatch", message: "account does not support instrument currency" });
        }
      }
    }
    for (const field of ["currency", "fromCurrency", "toCurrency", "feeCurrency"]) {
      if (Object.prototype.hasOwnProperty.call(transaction, field) && !CURRENCIES.has(transaction[field])) {
        issues.push({ path: `${path}.${field}`, code: "unsupported-currency", message: "currency is unsupported" });
      }
    }
    if ((type === "cash-in" || type === "cash-out" || type === "position-in" || type === "position-out") && !["begin", "end"].includes(transaction.timing)) {
      issues.push({ path: `${path}.timing`, code: transaction.timing == null ? "required" : "invalid-timing", message: "timing must be begin or end" });
    }
    if (type === "fx-conversion" && transaction.fromCurrency === transaction.toCurrency) {
      issues.push({ path: `${path}.toCurrency`, code: "same-currency-conversion", message: "conversion currencies must differ" });
    }
    const positiveFields = [
      "amount", "quantity", "price", "gross", "factor", "fromAmount", "toAmount",
    ];
    const nonNegativeFields = [
      "commission", "tax", "otherFees", "withholding", "net", "fee", "cashConsideration",
      "fairValueBase", "costBasisLocal", "costBasisBase", "carriedCostBasisLocal", "carriedCostBasisBase",
    ];
    for (const field of positiveFields) {
      if (Object.prototype.hasOwnProperty.call(transaction, field)) {
        validateDecimalField(transaction, field, path, issues, {
          positive: field !== "cashConsideration",
          maxScale: ["quantity", "factor"].includes(field) ? 12 : 2,
        });
      }
    }
    for (const field of nonNegativeFields) {
      validateDecimalField(transaction, field, path, issues, { nonNegative: true, maxScale: 2 });
    }
    if (type === "reorganization") {
      const factor = validateDecimalField(transaction, "shareFactor", path, issues, { nonNegative: true, maxScale: 12 });
      const allocation = validateDecimalField(transaction, "basisAllocationToNew", path, issues, { nonNegative: true, maxScale: 12 });
      if (allocation && compare(allocation, ONE) > 0) {
        issues.push({ path: `${path}.basisAllocationToNew`, code: "ratio-out-of-range", message: "allocation must be within [0,1]" });
      }
      if (!transaction.toInstrumentId && factor && compare(factor, ZERO) !== 0) {
        issues.push({ path: `${path}.shareFactor`, code: "missing-new-instrument", message: "shareFactor requires toInstrumentId" });
      }
      if (!transaction.toInstrumentId && allocation && compare(allocation, ZERO) !== 0) {
        issues.push({ path: `${path}.basisAllocationToNew`, code: "missing-new-instrument", message: "allocation requires toInstrumentId" });
      }
    }
    if (type === "dividend") {
      const gross = validateDecimalField(transaction, "gross", path, [], { positive: true, maxScale: 2 });
      const withholding = validateDecimalField(transaction, "withholding", path, [], { nonNegative: true, maxScale: 2 });
      const net = validateDecimalField(transaction, "net", path, [], { nonNegative: true, maxScale: 2 });
      if (gross && withholding && net && compare(subtract(gross, withholding), net) !== 0) {
        issues.push({ path: `${path}.net`, code: "amount-not-conserved", message: "gross - withholding must equal net" });
      }
    }
    if (type === "buy" || type === "sell") {
      try {
        const gross = multiply(
          parseDecimal(transaction.quantity, `${path}.quantity`, { positive: true, maxScale: 12 }),
          parseDecimal(transaction.price, `${path}.price`, { positive: true, maxScale: 2 }),
        );
        if (gross.scale > 2) {
          issues.push({ path: `${path}.quantity`, code: "minor-unit-precision", message: "price × quantity exceeds currency minor-unit precision" });
        }
      } catch {
        // Field-level issues above already identify malformed decimals.
      }
    }
  }
  for (const [index, transaction] of ledger.transactions.entries()) {
    if (transaction.type === "dividend-tax-adjustment" && !dividendIds.has(transaction.dividendTransactionId)) {
      issues.push({ path: `transactions[${index}].dividendTransactionId`, code: "broken-reference", message: "dividend does not exist" });
    }
  }
  if (issues.length) throw new PortfolioValidationError(issues);
  return { ledger, fingerprint: fingerprintText(sourceText) };
}

function instrumentMap(ledger) {
  return new Map(ledger.instruments.map((instrument) => [instrument.id, instrument]));
}

function checkpointDateFor(transaction, ledger, dateField, instrumentId) {
  const date = transaction[dateField];
  if (!instrumentId) return date;
  const instrument = ledger.instruments.find((candidate) => candidate.id === instrumentId);
  return instrument?.market === "us" ? addDays(date, 1) : date;
}

function transactionPhases(ledger) {
  const phases = [];
  for (const transaction of ledger.transactions) {
    if (transaction.type === "dividend") {
      phases.push({
        transaction,
        kind: "dividend-ex",
        date: checkpointDateFor(transaction, ledger, "exDate", transaction.instrumentId),
        priority: 1,
        phaseOrder: 0,
      });
      phases.push({
        transaction,
        kind: "dividend-pay",
        date: checkpointDateFor(transaction, ledger, "payDate", transaction.instrumentId),
        priority: 1,
        phaseOrder: 1,
      });
      continue;
    }
    let dateField = "effectiveDate";
    if (transaction.type === "buy" || transaction.type === "sell") dateField = "tradeDate";
    if (["cash-in", "cash-out", "position-in", "position-out"].includes(transaction.type)) dateField = "valuationDate";
    const instrumentId =
      ["buy", "sell", "split", "stock-dividend"].includes(transaction.type)
        ? transaction.instrumentId
        : transaction.type === "reorganization"
          ? transaction.fromInstrumentId
          : null;
    phases.push({
      transaction,
      kind: transaction.type,
      date: checkpointDateFor(transaction, ledger, dateField, instrumentId),
      priority: ["split", "stock-dividend", "reorganization"].includes(transaction.type) ? 0 : 1,
      phaseOrder: 0,
    });
  }
  return phases.sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.priority - right.priority ||
      String(left.transaction.createdAt ?? "").localeCompare(String(right.transaction.createdAt ?? "")) ||
      left.transaction.id.localeCompare(right.transaction.id) ||
      left.phaseOrder - right.phaseOrder,
  );
}

function newPosition(accountId, instrumentId) {
  return {
    accountId,
    instrumentId,
    quantity: ZERO,
    costBasisLocal: ZERO,
    costBasisBase: ZERO,
    realizedPnlLocal: ZERO,
    realizedPnlBase: ZERO,
    netIncomeLocal: ZERO,
    netIncomeBase: ZERO,
    localContributionBase: ZERO,
    fxContributionBase: ZERO,
    firstBuyDate: null,
    baseUnavailable: null,
  };
}

function createState(ledger) {
  return {
    ledger,
    instruments: instrumentMap(ledger),
    cash: new Map(
      ledger.accounts.map((account) => [
        account.id,
        new Map(account.currencies.map((currency) => [currency, ZERO])),
      ]),
    ),
    positions: new Map(),
    receivables: new Map(),
    externalFlows: [],
    cashReferenceBase: ZERO,
    conversionSpread: ZERO,
    dividendAdjustments: new Map(),
    warnings: [],
    baseUnavailable: null,
  };
}

function positionKey(accountId, instrumentId) {
  return `${accountId}\u0000${instrumentId}`;
}

function getPosition(state, accountId, instrumentId) {
  const key = positionKey(accountId, instrumentId);
  if (!state.positions.has(key)) state.positions.set(key, newPosition(accountId, instrumentId));
  return state.positions.get(key);
}

function getCash(state, accountId, currency) {
  return state.cash.get(accountId)?.get(currency) ?? ZERO;
}

function changeCash(state, accountId, currency, amount) {
  const accountCash = state.cash.get(accountId);
  if (!accountCash?.has(currency)) {
    throw new PortfolioValidationError([
      { path: `accounts.${accountId}.${currency}`, code: "account-currency-mismatch", message: "account does not support currency" },
    ]);
  }
  accountCash.set(currency, add(accountCash.get(currency), amount));
}

function missingFx(date, currency = "USD") {
  return {
    code: "missing-fx",
    reason: "missing-fx",
    date,
    currency,
  };
}

function markBaseUnavailable(state, date, currency = "USD", position = null) {
  const unavailable = missingFx(date, currency);
  state.baseUnavailable ??= unavailable;
  if (position) position.baseUnavailable ??= unavailable;
  return unavailable;
}

function publicUnavailable(value) {
  return value ? { code: value.code, reason: value.reason } : null;
}

function fxFor(options, date, currency, { allowMissing = false } = {}) {
  if (currency === "CNY") return ONE;
  const checkpoint = options.checkpointFx?.[date];
  const raw = plainObject(checkpoint) ? checkpoint[currency] : checkpoint;
  try {
    return parseDecimal(raw, `checkpointFx.${date}.${currency}`, { positive: true, maxScale: 8 });
  } catch (error) {
    if (allowMissing) return null;
    throw new PortfolioValidationError([
      { path: `checkpointFx.${date}.${currency}`, code: "missing-fx", message: "checkpoint FX is required" },
    ]);
  }
}

function moneyField(transaction, field) {
  return parseDecimal(transaction[field], `${transaction.id}.${field}`, { nonNegative: true, maxScale: 2 });
}

function positiveField(transaction, field, maxScale = 12) {
  return parseDecimal(transaction[field], `${transaction.id}.${field}`, { positive: true, maxScale });
}

function recordCashReference(state, currency, amount, fx) {
  if (currency === "USD" && fx) {
    state.cashReferenceBase = add(state.cashReferenceBase, multiply(amount, fx));
  }
}

function throwReplay(transaction, code, message, field = "quantity") {
  throw new PortfolioValidationError([
    { path: `transactions.${transaction.id}.${field}`, code, message },
  ]);
}

function applyPhase(state, phase, options) {
  const transaction = phase.transaction;
  const instrument = state.instruments.get(transactionInstrumentId(transaction));
  const currency = instrument?.currency ?? transaction.currency;
  const fx = currency
    ? fxFor(options, phase.date, currency, { allowMissing: true })
    : ONE;

  if (phase.kind === "cash-in" || phase.kind === "cash-out") {
    const amount = moneyField(transaction, "amount");
    const signed = phase.kind === "cash-in" ? amount : dec(-amount.coefficient, amount.scale);
    changeCash(state, transaction.accountId, transaction.currency, signed);
    const flowFx = fxFor(options, phase.date, transaction.currency, {
      allowMissing: true,
    });
    const base = flowFx ? multiply(signed, flowFx) : null;
    if (!flowFx) markBaseUnavailable(state, phase.date, transaction.currency);
    state.externalFlows.push({
      date: phase.date,
      timing: transaction.timing,
      amount: base,
      localAmount: signed,
      currency: transaction.currency,
      transactionId: transaction.id,
    });
    recordCashReference(state, transaction.currency, signed, flowFx);
    return;
  }

  if (phase.kind === "buy" || phase.kind === "sell") {
    const quantity = positiveField(transaction, "quantity");
    const gross = multiply(quantity, positiveField(transaction, "price", 2));
    const fees = add(add(moneyField(transaction, "commission"), moneyField(transaction, "tax")), moneyField(transaction, "otherFees"));
    const position = getPosition(state, transaction.accountId, transaction.instrumentId);
    if (phase.kind === "buy") {
      const total = add(gross, fees);
      changeCash(state, transaction.accountId, instrument.currency, dec(-total.coefficient, total.scale));
      position.quantity = add(position.quantity, quantity);
      position.costBasisLocal = add(position.costBasisLocal, total);
      if (fx) position.costBasisBase = add(position.costBasisBase, multiply(total, fx));
      else markBaseUnavailable(state, phase.date, instrument.currency, position);
      position.firstBuyDate ??= transaction.tradeDate;
      recordCashReference(state, instrument.currency, dec(-total.coefficient, total.scale), fx);
      return;
    }
    if (compare(quantity, position.quantity) > 0) {
      throwReplay(transaction, "insufficient-position", "sell exceeds the available quantity");
    }
    const disposedLocal = proportionalMoney(position.costBasisLocal, quantity, position.quantity);
    const disposedBase = proportionalMoney(position.costBasisBase, quantity, position.quantity);
    const net = subtract(gross, fees);
    const localPnl = subtract(net, disposedLocal);
    const baseProceeds = fx ? multiply(net, fx) : null;
    position.quantity = subtract(position.quantity, quantity);
    position.costBasisLocal = subtract(position.costBasisLocal, disposedLocal);
    position.costBasisBase = subtract(position.costBasisBase, disposedBase);
    position.realizedPnlLocal = add(position.realizedPnlLocal, localPnl);
    if (fx && !position.baseUnavailable) {
      position.realizedPnlBase = add(position.realizedPnlBase, subtract(baseProceeds, disposedBase));
      position.localContributionBase = add(position.localContributionBase, multiply(localPnl, fx));
      position.fxContributionBase = add(position.fxContributionBase, subtract(multiply(disposedLocal, fx), disposedBase));
    } else {
      markBaseUnavailable(state, phase.date, instrument.currency, position);
    }
    if (compare(position.quantity, ZERO) === 0) {
      position.costBasisLocal = ZERO;
      position.costBasisBase = ZERO;
    }
    changeCash(state, transaction.accountId, instrument.currency, net);
    recordCashReference(state, instrument.currency, net, fx);
    return;
  }

  if (phase.kind === "position-in" || phase.kind === "position-out") {
    const quantity = positiveField(transaction, "quantity");
    const position = getPosition(state, transaction.accountId, transaction.instrumentId);
    const localBasis = moneyField(transaction, "costBasisLocal");
    const baseBasis = moneyField(transaction, "costBasisBase");
    const fairValue = moneyField(transaction, "fairValueBase");
    const direction = phase.kind === "position-in" ? 1 : -1;
    if (direction > 0) {
      position.quantity = add(position.quantity, quantity);
      position.costBasisLocal = add(position.costBasisLocal, localBasis);
      position.costBasisBase = add(position.costBasisBase, baseBasis);
      position.firstBuyDate ??= transaction.valuationDate;
    } else {
      if (compare(quantity, position.quantity) > 0) throwReplay(transaction, "insufficient-position", "position-out exceeds available quantity");
      const disposedLocal = proportionalMoney(position.costBasisLocal, quantity, position.quantity);
      const disposedBase = proportionalMoney(position.costBasisBase, quantity, position.quantity);
      if (moneyString(disposedLocal) !== moneyString(localBasis) || moneyString(disposedBase) !== moneyString(baseBasis)) {
        throwReplay(transaction, "carried-basis-mismatch", "position-out cost basis does not match replay", "costBasisLocal");
      }
      position.quantity = subtract(position.quantity, quantity);
      position.costBasisLocal = subtract(position.costBasisLocal, disposedLocal);
      position.costBasisBase = subtract(position.costBasisBase, disposedBase);
      if (compare(position.quantity, ZERO) === 0) {
        position.costBasisLocal = ZERO;
        position.costBasisBase = ZERO;
      }
    }
    state.externalFlows.push({
      date: phase.date,
      timing: transaction.timing,
      amount: direction > 0 ? fairValue : dec(-fairValue.coefficient, fairValue.scale),
      transactionId: transaction.id,
    });
    return;
  }

  if (phase.kind === "dividend-ex") {
    const gross = moneyField(transaction, "gross");
    const withholding = moneyField(transaction, "withholding");
    const net = moneyField(transaction, "net");
    const position = getPosition(state, transaction.accountId, transaction.instrumentId);
    const baseNet = fx ? multiply(net, fx) : null;
    position.netIncomeLocal = add(position.netIncomeLocal, net);
    if (baseNet) position.netIncomeBase = add(position.netIncomeBase, baseNet);
    else markBaseUnavailable(state, phase.date, instrument.currency, position);
    state.receivables.set(transaction.id, {
      accountId: transaction.accountId,
      instrumentId: transaction.instrumentId,
      currency: instrument.currency,
      amount: net,
      gross,
      withholding,
      paid: false,
    });
    recordCashReference(state, instrument.currency, net, fx);
    return;
  }

  if (phase.kind === "dividend-pay") {
    const receivable = state.receivables.get(transaction.id);
    if (!receivable || receivable.paid) throwReplay(transaction, "dividend-state", "dividend receivable is missing", "payDate");
    changeCash(state, receivable.accountId, receivable.currency, receivable.amount);
    receivable.paid = true;
    return;
  }

  if (phase.kind === "dividend-tax-adjustment") {
    const dividend = state.receivables.get(transaction.dividendTransactionId);
    if (!dividend) throwReplay(transaction, "broken-reference", "referenced dividend has not reached ex-date", "dividendTransactionId");
    if (transaction.accountId !== dividend.accountId || transaction.currency !== dividend.currency) {
      throwReplay(transaction, "dividend-reference-mismatch", "adjustment account/currency differs from dividend", "dividendTransactionId");
    }
    const amount = moneyField(transaction, "amount");
    const prior = state.dividendAdjustments.get(transaction.dividendTransactionId) ?? ZERO;
    const totalAdjustment = add(prior, amount);
    if (compare(add(dividend.withholding, totalAdjustment), dividend.gross) > 0) {
      throwReplay(transaction, "withholding-exceeded", "cumulative withholding exceeds gross dividend", "amount");
    }
    state.dividendAdjustments.set(transaction.dividendTransactionId, totalAdjustment);
    changeCash(state, transaction.accountId, transaction.currency, dec(-amount.coefficient, amount.scale));
    const position = getPosition(state, dividend.accountId, dividend.instrumentId);
    position.netIncomeLocal = subtract(position.netIncomeLocal, amount);
    if (fx && !position.baseUnavailable) {
      position.netIncomeBase = subtract(position.netIncomeBase, multiply(amount, fx));
    } else {
      markBaseUnavailable(state, phase.date, transaction.currency, position);
    }
    recordCashReference(state, transaction.currency, dec(-amount.coefficient, amount.scale), fx);
    return;
  }

  if (phase.kind === "split" || phase.kind === "stock-dividend") {
    const position = getPosition(state, transaction.accountId, transaction.instrumentId);
    position.quantity = multiply(position.quantity, positiveField(transaction, "factor"));
    return;
  }

  if (phase.kind === "fx-conversion") {
    const fromAmount = moneyField(transaction, "fromAmount");
    const toAmount = moneyField(transaction, "toAmount");
    const fee = moneyField(transaction, "fee");
    let fromDebit = fromAmount;
    let toCredit = toAmount;
    if (transaction.feeCurrency === transaction.fromCurrency) fromDebit = add(fromDebit, fee);
    else if (transaction.feeCurrency === transaction.toCurrency) toCredit = subtract(toCredit, fee);
    else changeCash(state, transaction.accountId, transaction.feeCurrency, dec(-fee.coefficient, fee.scale));
    changeCash(state, transaction.accountId, transaction.fromCurrency, dec(-fromDebit.coefficient, fromDebit.scale));
    changeCash(state, transaction.accountId, transaction.toCurrency, toCredit);
    const fromFx = fxFor(options, phase.date, transaction.fromCurrency, {
      allowMissing: true,
    });
    const toFx = fxFor(options, phase.date, transaction.toCurrency, {
      allowMissing: true,
    });
    if (!fromFx) markBaseUnavailable(state, phase.date, transaction.fromCurrency);
    if (!toFx) markBaseUnavailable(state, phase.date, transaction.toCurrency);
    recordCashReference(state, transaction.fromCurrency, dec(-fromDebit.coefficient, fromDebit.scale), fromFx);
    recordCashReference(state, transaction.toCurrency, toCredit, toFx);
    if (transaction.feeCurrency !== transaction.fromCurrency && transaction.feeCurrency !== transaction.toCurrency) {
      const feeFx = fxFor(options, phase.date, transaction.feeCurrency, {
        allowMissing: true,
      });
      if (!feeFx) markBaseUnavailable(state, phase.date, transaction.feeCurrency);
      recordCashReference(state, transaction.feeCurrency, dec(-fee.coefficient, fee.scale), feeFx);
    }
    if (fromFx && toFx) {
      state.conversionSpread = add(
        state.conversionSpread,
        subtract(multiply(toCredit, toFx), multiply(fromDebit, fromFx)),
      );
    }
    return;
  }

  if (phase.kind === "cash-transfer") {
    const amount = moneyField(transaction, "amount");
    changeCash(state, transaction.fromAccountId, transaction.currency, dec(-amount.coefficient, amount.scale));
    changeCash(state, transaction.toAccountId, transaction.currency, amount);
    return;
  }

  if (phase.kind === "position-transfer") {
    const quantity = positiveField(transaction, "quantity");
    const from = getPosition(state, transaction.fromAccountId, transaction.instrumentId);
    if (compare(quantity, from.quantity) > 0) throwReplay(transaction, "insufficient-position", "transfer exceeds available quantity");
    const disposedLocal = proportionalMoney(from.costBasisLocal, quantity, from.quantity);
    const disposedBase = proportionalMoney(from.costBasisBase, quantity, from.quantity);
    if (
      moneyString(disposedLocal) !== transaction.carriedCostBasisLocal ||
      moneyString(disposedBase) !== transaction.carriedCostBasisBase
    ) {
      throwReplay(transaction, "carried-basis-mismatch", "carried basis does not match replay", "carriedCostBasisLocal");
    }
    from.quantity = subtract(from.quantity, quantity);
    from.costBasisLocal = subtract(from.costBasisLocal, disposedLocal);
    from.costBasisBase = subtract(from.costBasisBase, disposedBase);
    const to = getPosition(state, transaction.toAccountId, transaction.instrumentId);
    to.quantity = add(to.quantity, quantity);
    to.costBasisLocal = add(to.costBasisLocal, disposedLocal);
    to.costBasisBase = add(to.costBasisBase, disposedBase);
    if (from.baseUnavailable) {
      to.baseUnavailable ??= from.baseUnavailable;
      state.baseUnavailable ??= from.baseUnavailable;
    }
    to.firstBuyDate ??= from.firstBuyDate;
    return;
  }

  if (phase.kind === "reorganization") {
    const from = getPosition(state, transaction.accountId, transaction.fromInstrumentId);
    const oldQuantity = from.quantity;
    const oldLocal = from.costBasisLocal;
    const oldBase = from.costBasisBase;
    const allocation = parseDecimal(transaction.basisAllocationToNew, `${transaction.id}.basisAllocationToNew`, { nonNegative: true, maxScale: 12 });
    const allocatedLocal = multiply(oldLocal, allocation);
    const allocatedBase = multiply(oldBase, allocation);
    const disposedLocal = subtract(oldLocal, allocatedLocal);
    const disposedBase = subtract(oldBase, allocatedBase);
    const cash = moneyField(transaction, "cashConsideration");
    const localPnl = subtract(cash, disposedLocal);
    from.quantity = ZERO;
    from.costBasisLocal = ZERO;
    from.costBasisBase = ZERO;
    from.realizedPnlLocal = add(from.realizedPnlLocal, localPnl);
    if (fx && !from.baseUnavailable) {
      from.realizedPnlBase = add(from.realizedPnlBase, subtract(multiply(cash, fx), disposedBase));
      from.localContributionBase = add(from.localContributionBase, multiply(localPnl, fx));
      from.fxContributionBase = add(from.fxContributionBase, subtract(multiply(disposedLocal, fx), disposedBase));
    } else if (compare(cash, ZERO) > 0 || from.baseUnavailable) {
      markBaseUnavailable(state, phase.date, instrument.currency, from);
    }
    if (transaction.toInstrumentId) {
      const toInstrument = state.instruments.get(transaction.toInstrumentId);
      if (toInstrument.currency !== instrument.currency) {
        throwReplay(transaction, "cross-currency-reorganization", "v1 reorganization currencies must match", "toInstrumentId");
      }
      const to = getPosition(state, transaction.accountId, transaction.toInstrumentId);
      to.quantity = add(to.quantity, multiply(oldQuantity, parseDecimal(transaction.shareFactor, `${transaction.id}.shareFactor`, { nonNegative: true, maxScale: 12 })));
      to.costBasisLocal = add(to.costBasisLocal, allocatedLocal);
      to.costBasisBase = add(to.costBasisBase, allocatedBase);
      if (from.baseUnavailable) to.baseUnavailable ??= from.baseUnavailable;
      to.firstBuyDate ??= from.firstBuyDate;
    }
    if (compare(cash, ZERO) > 0) {
      changeCash(state, transaction.accountId, instrument.currency, cash);
      recordCashReference(state, instrument.currency, cash, fx);
    }
  }
}

function replayLedger(ledger, options = {}, throughDate = null) {
  const state = createState(ledger);
  for (const phase of transactionPhases(ledger)) {
    if (throughDate && phase.date > throughDate) break;
    applyPhase(state, phase, options);
  }
  for (const [accountId, currencies] of state.cash) {
    for (const [currency, amount] of currencies) {
      if (compare(amount, ZERO) < 0) {
        state.warnings.push({ code: "negative-cash", accountId, currency, amount: moneyString(amount) });
      }
    }
  }
  return state;
}

function publicHoldings(state, options = {}) {
  const cashByAccount = {};
  for (const [accountId, currencies] of state.cash) {
    cashByAccount[accountId] = Object.fromEntries(
      [...currencies].map(([currency, amount]) => [currency, moneyString(amount)]),
    );
  }
  const positionsByAccount = [];
  const valuationIssues = [];
  let valuationTotal = ZERO;
  for (const entry of state.positions.values()) {
    const instrument = state.instruments.get(entry.instrumentId);
    const endingPriceRaw = options.endingPrices?.[entry.instrumentId];
    const endingPrice =
      endingPriceRaw == null
        ? null
        : parseDecimal(endingPriceRaw, `endingPrices.${entry.instrumentId}`, { positive: true, maxScale: 8 });
    // Without an ending date there is no eligible FX; a USD price must not be
    // converted at 1.0 by accident.
    const endingFx = options.endingDate
      ? fxFor(options, options.endingDate, instrument.currency, { allowMissing: true })
      : instrument.currency === "CNY"
        ? ONE
        : null;
    const marketLocal = endingPrice ? multiply(entry.quantity, endingPrice) : null;
    if (options.endingDate && compare(entry.quantity, ZERO) > 0) {
      if (!marketLocal) valuationIssues.push({ code: "missing-raw-data", instrumentId: entry.instrumentId });
      else if (!endingFx) valuationIssues.push({ code: "missing-fx", instrumentId: entry.instrumentId });
      else valuationTotal = add(valuationTotal, multiply(marketLocal, endingFx));
    }
    const unrealizedLocal = marketLocal ? subtract(marketLocal, entry.costBasisLocal) : null;
    const baseUnavailable =
      entry.baseUnavailable ??
      (marketLocal && !endingFx
        ? markBaseUnavailable(state, options.endingDate, instrument.currency, entry)
        : null);
    const baseComplete = !baseUnavailable;
    const unrealizedBase =
      marketLocal && endingFx && baseComplete
        ? subtract(multiply(marketLocal, endingFx), entry.costBasisBase)
        : null;
    const quantity = decimalString(entry.quantity);
    const avgCostLocal =
      compare(entry.quantity, ZERO) > 0
        ? decimalString(dec(roundDivide(entry.costBasisLocal.coefficient * pow10(12 + entry.quantity.scale), pow10(entry.costBasisLocal.scale) * entry.quantity.coefficient), 12))
        : "0";
    const avgCostBase =
      baseComplete && compare(entry.quantity, ZERO) > 0
        ? decimalString(dec(roundDivide(entry.costBasisBase.coefficient * pow10(12 + entry.quantity.scale), pow10(entry.costBasisBase.scale) * entry.quantity.coefficient), 12))
        : baseComplete
          ? "0"
          : null;
    positionsByAccount.push({
      accountId: entry.accountId,
      instrumentId: entry.instrumentId,
      quantity,
      avgCostLocal,
      costBasisLocal: moneyString(entry.costBasisLocal),
      avgCostBase,
      costBasisBase: baseComplete ? moneyString(entry.costBasisBase) : null,
      realizedPnlLocal: moneyString(entry.realizedPnlLocal),
      realizedPnlBase: baseComplete ? moneyString(entry.realizedPnlBase) : null,
      netIncomeLocal: moneyString(entry.netIncomeLocal),
      netIncomeBase: baseComplete ? moneyString(entry.netIncomeBase) : null,
      ...(unrealizedLocal ? { unrealizedPnlLocal: moneyString(unrealizedLocal) } : {}),
      ...(marketLocal
        ? { unrealizedPnlBase: unrealizedBase ? moneyString(unrealizedBase) : null }
        : {}),
      ...(baseUnavailable
        ? { baseUnavailable: publicUnavailable(baseUnavailable) }
        : {}),
      firstBuyDate: entry.firstBuyDate,
    });
  }
  positionsByAccount.sort(
    (left, right) => left.accountId.localeCompare(right.accountId) || left.instrumentId.localeCompare(right.instrumentId),
  );
  const aggregate = new Map();
  for (const position of positionsByAccount) {
    const current = aggregate.get(position.instrumentId) ?? {
      instrumentId: position.instrumentId,
      quantity: ZERO,
      costBasisLocal: ZERO,
      costBasisBase: ZERO,
      baseUnavailable: null,
    };
    current.quantity = add(current.quantity, parseDecimal(position.quantity, "quantity", { nonNegative: true }));
    current.costBasisLocal = add(current.costBasisLocal, parseDecimal(position.costBasisLocal, "costBasisLocal"));
    if (position.costBasisBase === null) {
      current.baseUnavailable ??= position.baseUnavailable ?? {
        code: "missing-fx",
        reason: "missing-fx",
      };
    } else {
      current.costBasisBase = add(
        current.costBasisBase,
        parseDecimal(position.costBasisBase, "costBasisBase"),
      );
    }
    aggregate.set(position.instrumentId, current);
  }
  const aggregateByInstrument = [...aggregate.values()].map((entry) => ({
    instrumentId: entry.instrumentId,
    quantity: decimalString(entry.quantity),
    costBasisLocal: moneyString(entry.costBasisLocal),
    costBasisBase: entry.baseUnavailable ? null : moneyString(entry.costBasisBase),
    ...(entry.baseUnavailable
      ? { baseUnavailable: publicUnavailable(entry.baseUnavailable) }
      : {}),
  }));
  let valuation;
  if (options.endingDate) {
    // Cash and unpaid receivables enter the total at the same eligible FX as
    // the series' V_d; the UI must display this rather than recompute it.
    for (const [, currencies] of state.cash) {
      for (const [currency, amount] of currencies) {
        if (compare(amount, ZERO) === 0) continue;
        const fx = fxFor(options, options.endingDate, currency, { allowMissing: true });
        if (fx) valuationTotal = add(valuationTotal, multiply(amount, fx));
        else valuationIssues.push({ code: "missing-fx", currency });
      }
    }
    for (const receivable of state.receivables.values()) {
      if (receivable.paid) continue;
      const fx = fxFor(options, options.endingDate, receivable.currency, { allowMissing: true });
      if (fx) valuationTotal = add(valuationTotal, multiply(receivable.amount, fx));
      else valuationIssues.push({ code: "missing-fx", currency: receivable.currency });
    }
    if (state.baseUnavailable) valuationIssues.push({ code: "missing-fx" });
    const blocking = valuationIssues
      .slice()
      .sort((left, right) => unavailableRank(left.code) - unavailableRank(right.code))[0];
    valuation = {
      endingDate: options.endingDate,
      totalBase: blocking ? null : moneyString(valuationTotal),
      ...(blocking ? { unavailable: { code: blocking.code, reason: blocking.code } } : {}),
    };
  }
  return {
    cashByAccount,
    positionsByAccount,
    aggregateByInstrument,
    warnings: state.warnings,
    availability: {
      local: { status: "complete" },
      base: state.baseUnavailable
        ? { status: "unavailable", reason: state.baseUnavailable.reason }
        : { status: "complete" },
    },
    ...(valuation ? { valuation } : {}),
  };
}

export function deriveHoldings(ledger, options = {}) {
  if (!ledger || ledger.format !== "codeshell.portfolio-transactions" || ledger.version !== 1) {
    throw new PortfolioValidationError([
      { path: "$", code: "invalid-ledger", message: "deriveHoldings needs a parsed version 1 ledger" },
    ]);
  }
  return publicHoldings(replayLedger(ledger, options), options);
}

// Display-ready P&L facts for the pure rule engine. All component addition is
// kept in the financial engine; UI adapters only attach source provenance.
export function holdingsUnrealizedSummary(holdings) {
  const positions = (holdings?.positionsByAccount ?? []).filter((item) => Number(item.quantity) > 0);
  if (!positions.length) return { pnlBase: "0.00", costBase: "0.00", returnPercent: null };
  if (positions.some((item) => item.unrealizedPnlBase == null || item.costBasisBase == null)) {
    return { pnlBase: null, costBase: null, returnPercent: null };
  }
  const pnl = positions.reduce((sum, item) => add(sum, parseDecimal(item.unrealizedPnlBase, "pnl")), ZERO);
  const cost = positions.reduce((sum, item) => add(sum, parseDecimal(item.costBasisBase, "cost")), ZERO);
  return { pnlBase: moneyString(pnl), costBase: moneyString(cost),
    returnPercent: compare(cost, ZERO) > 0 ? decimalNumber(pnl) / decimalNumber(cost) * 100 : null };
}

export function portfolioPnlContributors(ledger, holdings, sourceStatusByInstrument = {}) {
  const instruments = new Map(ledger.instruments.map((instrument) => [instrument.id, instrument]));
  return holdings.positionsByAccount
    .filter((position) => compare(parseDecimal(position.quantity, "quantity"), ZERO) > 0)
    .map((position) => {
      const sourceState = sourceStatusByInstrument[position.instrumentId];
      const identity = {
        instrumentId: position.instrumentId,
        symbol: instruments.get(position.instrumentId)?.symbol ?? position.instrumentId,
        account: position.accountId,
      };
      if (sourceState?.status !== "available") {
        return {
          ...identity,
          pnlBase: null,
          unavailableReason: sourceState?.reason ?? "missing-raw-data",
        };
      }
      if (
        position.baseUnavailable ||
        position.realizedPnlBase == null ||
        position.netIncomeBase == null
      ) {
        return {
          ...identity,
          pnlBase: null,
          unavailableReason: position.baseUnavailable?.reason ?? "missing-fx",
        };
      }
      if (position.unrealizedPnlBase == null) {
        return { ...identity, pnlBase: null, unavailableReason: "missing-raw-data" };
      }
      const total = add(
        add(
          parseDecimal(position.realizedPnlBase, "realizedPnlBase", { maxScale: 2 }),
          parseDecimal(position.netIncomeBase, "netIncomeBase", { maxScale: 2 }),
        ),
        parseDecimal(position.unrealizedPnlBase, "unrealizedPnlBase", { maxScale: 2 }),
      );
      return { ...identity, pnlBase: moneyString(total) };
    })
    .sort(
      (left, right) =>
        left.symbol.localeCompare(right.symbol) || left.account.localeCompare(right.account),
    );
}

function validateRawSource(instrument, source) {
  if (!plainObject(source) || !plainObject(source.sidecar) || !Array.isArray(source.observations)) {
    return { code: "missing-raw-data", path: source?.path ?? `data/market-raw/${instrument.symbol}.csv` };
  }
  const expectedPath = `data/market-raw/${instrument.symbol}.csv`;
  if (source.path !== expectedPath) {
    return { code: "missing-raw-data", path: source.path ?? expectedPath };
  }
  const sidecar = source.sidecar;
  if (
    sidecar.adjust !== "none" ||
    sidecar.purpose !== "portfolio-valuation" ||
    sidecar.symbol !== instrument.symbol ||
    sidecar.market !== instrument.market ||
    typeof sidecar.fingerprint !== "string" ||
    typeof sidecar.source !== "string" ||
    Number.isNaN(Date.parse(sidecar.syncedAt))
  ) {
    return { code: "missing-raw-data", path: source.path ?? `data/market-raw/${instrument.symbol}.csv` };
  }
  try {
    let prior = "";
    for (const observation of source.observations) {
      if (!validDate(observation.date) || observation.date <= prior) throw new Error("bad date");
      parseDecimal(observation.close, "close", { positive: true, maxScale: 8 });
      prior = observation.date;
    }
  } catch {
    return { code: "missing-raw-data", path: source.path ?? `data/market-raw/${instrument.symbol}.csv` };
  }
  return null;
}

function dateRange(startDate, endDate) {
  if (!validDate(startDate) || !validDate(endDate) || endDate < startDate) {
    throw new Error("marketInputs need an ordered startDate/endDate");
  }
  const result = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) result.push(date);
  return result;
}

function sum(values) {
  return values.reduce((total, value) => add(total, value), ZERO);
}

function stateValue(state, observations, checkpointFx, date) {
  const securityValues = new Map();
  const incompleteAccounts = new Set();
  let total = ZERO;
  let complete = true;
  const convert = (amount, currency, accountId) => {
    const fx = fxFor({ checkpointFx }, date, currency, { allowMissing: true });
    if (!fx) {
      complete = false;
      incompleteAccounts.add(accountId);
      markBaseUnavailable(state, date, currency);
      return null;
    }
    return multiply(amount, fx);
  };
  for (const position of state.positions.values()) {
    if (compare(position.quantity, ZERO) <= 0) continue;
    const instrument = state.instruments.get(position.instrumentId);
    const observed = observations[position.instrumentId];
    if (!observed) {
      // A held position without an eligible price makes the whole checkpoint
      // value unknown; a partial sum would masquerade as the portfolio value.
      complete = false;
      incompleteAccounts.add(position.accountId);
      continue;
    }
    const local = multiply(position.quantity, parseDecimal(observed.close, "close", { positive: true, maxScale: 8 }));
    const base = convert(local, instrument.currency, position.accountId);
    securityValues.set(positionKey(position.accountId, position.instrumentId), {
      local,
      base,
    });
    if (base) total = add(total, base);
  }
  for (const [accountId, currencies] of state.cash) {
    for (const [currency, amount] of currencies) {
      if (compare(amount, ZERO) === 0) continue;
      const base = convert(amount, currency, accountId);
      if (base) total = add(total, base);
    }
  }
  for (const receivable of state.receivables.values()) {
    if (receivable.paid) continue;
    const base = convert(receivable.amount, receivable.currency, receivable.accountId);
    if (base) total = add(total, base);
  }
  return {
    total: complete ? total : null,
    securityValues,
    incompleteAccounts,
  };
}

function unavailableRank(code) {
  return [
    "missing-fx",
    "missing-raw-data",
    "price-age-exceeded",
    "fx-age-exceeded",
    "suspected-missing-corporate-action",
    "negative-cash",
    "non-positive-equity",
  ].indexOf(code);
}

function stateHasUsdExposure(state) {
  for (const currencies of state.cash.values()) {
    if (compare(currencies.get("USD") ?? ZERO, ZERO) !== 0) return true;
  }
  for (const position of state.positions.values()) {
    if (
      compare(position.quantity, ZERO) > 0 &&
      state.instruments.get(position.instrumentId)?.currency === "USD"
    ) {
      return true;
    }
  }
  return [...state.receivables.values()].some(
    (receivable) => !receivable.paid && receivable.currency === "USD",
  );
}

function phaseUsesUsd(state, phase) {
  const transaction = phase.transaction;
  if (
    [
      transaction.currency,
      transaction.fromCurrency,
      transaction.toCurrency,
      transaction.feeCurrency,
    ].includes("USD")
  ) {
    return true;
  }
  for (const instrumentId of [
    transaction.instrumentId,
    transaction.fromInstrumentId,
    transaction.toInstrumentId,
  ]) {
    if (instrumentId && state.instruments.get(instrumentId)?.currency === "USD") return true;
  }
  return false;
}

function genericCheckpointDetails(
  state,
  securityValues,
  checkpointFx,
  date,
  value,
  beginFlow,
  endFlow,
  incompleteAccounts = new Set(),
) {
  const cashByAccount = {};
  const securityValuesByAccount = {};
  const receivablesByAccount = {};
  const baseValueInternal = new Map();
  const foreignBaseValueInternal = new Map();
  const addAccountBase = (accountId, amount, foreign) => {
    baseValueInternal.set(accountId, add(baseValueInternal.get(accountId) ?? ZERO, amount));
    if (foreign) {
      foreignBaseValueInternal.set(
        accountId,
        add(foreignBaseValueInternal.get(accountId) ?? ZERO, amount),
      );
    }
  };

  for (const [accountId, currencies] of state.cash) {
    cashByAccount[accountId] = {};
    for (const [currency, amount] of currencies) {
      cashByAccount[accountId][currency] = moneyString(amount);
      if (compare(amount, ZERO) === 0) continue;
      const fx = fxFor({ checkpointFx }, date, currency, { allowMissing: true });
      if (fx) addAccountBase(accountId, multiply(amount, fx), currency !== "CNY");
    }
  }
  for (const position of state.positions.values()) {
    if (compare(position.quantity, ZERO) <= 0) continue;
    const securityValue = securityValues.get(positionKey(position.accountId, position.instrumentId));
    if (!securityValue) continue;
    const instrument = state.instruments.get(position.instrumentId);
    const { local: localValue, base: baseValue } = securityValue;
    securityValuesByAccount[position.accountId] ??= {};
    securityValuesByAccount[position.accountId][position.instrumentId] = {
      currency: instrument.currency,
      localValue: moneyString(localValue),
      baseValue: baseValue ? moneyString(baseValue) : null,
    };
    if (baseValue) {
      addAccountBase(position.accountId, baseValue, instrument.currency !== "CNY");
    }
  }
  for (const receivable of state.receivables.values()) {
    if (receivable.paid) continue;
    receivablesByAccount[receivable.accountId] ??= {};
    const existing = receivablesByAccount[receivable.accountId][receivable.currency];
    const local = add(
      existing ? parseDecimal(existing, "receivable", { maxScale: 2 }) : ZERO,
      receivable.amount,
    );
    receivablesByAccount[receivable.accountId][receivable.currency] = moneyString(local);
    const fx = fxFor({ checkpointFx }, date, receivable.currency, {
      allowMissing: true,
    });
    if (fx) {
      addAccountBase(
        receivable.accountId,
        multiply(receivable.amount, fx),
        receivable.currency !== "CNY",
      );
    }
  }
  return {
    cashByAccount,
    securityValuesByAccount,
    receivablesByAccount,
    // An account with any unconverted or unpriced item has no honest base
    // value; it is reported as null rather than as the sum of what was known.
    baseValueByAccount: Object.fromEntries([
      ...[...baseValueInternal]
        .filter(([accountId]) => !incompleteAccounts.has(accountId))
        .map(([accountId, amount]) => [accountId, moneyString(amount)]),
      ...[...incompleteAccounts].map((accountId) => [accountId, null]),
    ]),
    foreignBaseValueByAccount: Object.fromEntries(
      [...foreignBaseValueInternal]
        .filter(([accountId, amount]) => compare(amount, ZERO) !== 0 && !incompleteAccounts.has(accountId))
        .map(([accountId, amount]) => [accountId, moneyString(amount)]),
    ),
    value: value ? moneyString(value) : null,
    beginFlow: beginFlow ? moneyString(beginFlow) : null,
    endFlow: endFlow ? moneyString(endFlow) : null,
    ...(state.baseUnavailable
      ? { baseUnavailable: publicUnavailable(state.baseUnavailable) }
      : {}),
  };
}

export function portfolioValueSeries(ledger, marketInputs) {
  const dates = dateRange(marketInputs.startDate, marketInputs.endDate);
  const phases = transactionPhases(ledger);
  const state = createState(ledger);
  const checkpointFx = {};
  const checkpoints = [];
  const rawErrors = new Map();
  for (const instrument of ledger.instruments) {
    const error = validateRawSource(instrument, marketInputs.prices?.[instrument.id]);
    if (error) rawErrors.set(instrument.id, error);
  }
  const fxSource = marketInputs.fx?.USD;
  const fxInstrument = { symbol: "USDCNY", market: "fx" };
  const fxError = validateRawSource(fxInstrument, fxSource);
  let phaseIndex = 0;
  let priorValue = ZERO;
  const priorObservations = new Map();
  const largeJumps = [];
  for (const date of dates) {
    const observations = {};
    let provisional = false;
    let unavailable = null;
    const todayPhases = [];
    while (phaseIndex < phases.length && phases[phaseIndex].date === date) {
      todayPhases.push(phases[phaseIndex]);
      phaseIndex += 1;
    }
    const requiresUsd = stateHasUsdExposure(state) || todayPhases.some((phase) => phaseUsesUsd(state, phase));
    checkpointFx[date] = { date };
    if (requiresUsd) {
      if (!fxError) {
        const selected = selectObservation(date, fxSource.observations, {
          market: "fx",
          syncedAt: fxSource.sidecar.syncedAt,
        });
        if (selected) {
          observations.USD = { date: selected.observation.date, close: selected.observation.close, ageCalendarDays: selected.ageCalendarDays, availableAt: selected.availableAt };
          checkpointFx[date].USD = selected.observation.close;
          provisional ||= selected.provisional;
          if (selected.ageCalendarDays > 10) unavailable = { code: "fx-age-exceeded", fromDate: date, details: { ageCalendarDays: selected.ageCalendarDays } };
        } else {
          unavailable = { code: "missing-fx", fromDate: date, details: { path: fxSource?.path ?? "data/market-raw/USDCNY.csv", reason: "missing-fx" } };
        }
      } else {
        unavailable = { code: "missing-fx", fromDate: date, details: { path: fxError.path, reason: "missing-fx" } };
      }
    }
    for (const phase of todayPhases) applyPhase(state, phase, { checkpointFx });
    for (const position of state.positions.values()) {
      if (compare(position.quantity, ZERO) <= 0) continue;
      const instrument = state.instruments.get(position.instrumentId);
      const rawError = rawErrors.get(position.instrumentId);
      if (rawError) {
        const candidate = { code: rawError.code, fromDate: date, details: { path: rawError.path } };
        if (!unavailable || unavailableRank(candidate.code) < unavailableRank(unavailable.code)) unavailable = candidate;
        continue;
      }
      const source = marketInputs.prices[position.instrumentId];
      const selected = selectObservation(date, source.observations, {
        market: instrument.market,
        syncedAt: source.sidecar.syncedAt,
      });
      if (!selected) {
        unavailable ??= { code: "missing-raw-data", fromDate: date, details: { path: source.path } };
        continue;
      }
      observations[position.instrumentId] = { date: selected.observation.date, close: selected.observation.close, ageCalendarDays: selected.ageCalendarDays, availableAt: selected.availableAt };
      provisional ||= selected.provisional;
      if (selected.ageCalendarDays > 10) {
        unavailable ??= { code: "price-age-exceeded", fromDate: date, details: { instrumentId: position.instrumentId, ageCalendarDays: selected.ageCalendarDays } };
      }
      const previous = priorObservations.get(position.instrumentId);
      if (previous && previous.date !== selected.observation.date) {
        const priorNumber = decimalNumber(previous.close);
        const currentNumber = Number(selected.observation.close);
        const ratioChange = currentNumber / priorNumber - 1;
        const hasAction = todayPhases.some(
          (phase) =>
            ["split", "stock-dividend", "reorganization"].includes(phase.kind) &&
            transactionInstrumentId(phase.transaction) === position.instrumentId,
        );
        if (Math.abs(ratioChange) >= 0.35 && !hasAction) {
          largeJumps.push({ instrumentId: position.instrumentId, date, observationDate: selected.observation.date, change: ratioChange });
          unavailable ??= { code: "suspected-missing-corporate-action", fromDate: date, details: { instrumentId: position.instrumentId } };
        }
      }
      priorObservations.set(position.instrumentId, {
        date: selected.observation.date,
        close: parseDecimal(selected.observation.close, "close", { positive: true, maxScale: 8 }),
      });
    }
    const negativeCash = [...state.cash.values()].some((currencies) =>
      [...currencies.values()].some((amount) => compare(amount, ZERO) < 0),
    );
    if (negativeCash) {
      unavailable ??= { code: "negative-cash", fromDate: date, details: {} };
    }
    const { total: value, securityValues, incompleteAccounts } = stateValue(
      state,
      observations,
      checkpointFx,
      date,
    );
    if (state.baseUnavailable) {
      unavailable ??= {
        code: "missing-fx",
        fromDate: state.baseUnavailable.date ?? date,
        details: { reason: "missing-fx" },
      };
    }
    const flows = state.externalFlows.filter((flow) => flow.date === date);
    const beginFlows = flows
      .filter((flow) => flow.timing === "begin")
      .map((flow) => flow.amount);
    const endFlows = flows
      .filter((flow) => flow.timing === "end")
      .map((flow) => flow.amount);
    const beginFlow = beginFlows.some((flow) => flow === null)
      ? null
      : sum(beginFlows);
    const endFlow = endFlows.some((flow) => flow === null) ? null : sum(endFlows);
    let dailyReturn = null;
    if (value && beginFlow && endFlow) {
      const denominator = add(priorValue, beginFlow);
      const numerator = subtract(value, endFlow);
      if (compare(denominator, ZERO) <= 0 || compare(numerator, ZERO) < 0) {
        unavailable ??= { code: "non-positive-equity", fromDate: date, details: {} };
      } else if (!unavailable) {
        dailyReturn = decimalNumber(numerator) / decimalNumber(denominator) - 1;
      }
    }
    checkpoints.push({
      date,
      value: value ? moneyString(value) : null,
      beginFlow: beginFlow ? moneyString(beginFlow) : null,
      endFlow: endFlow ? moneyString(endFlow) : null,
      return: dailyReturn,
      provisional,
      observations,
      ...(unavailable ? { unavailable } : {}),
      details: genericCheckpointDetails(
        state,
        securityValues,
        checkpointFx,
        date,
        value,
        beginFlow,
        endFlow,
        incompleteAccounts,
      ),
    });
    if (value) priorValue = value;
  }
  return { checkpoints, checkpointFx, audit: { largeJumps }, state };
}

export function timeWeightedReturn(series) {
  if (!Array.isArray(series) || series.length === 0) {
    return { unavailable: { code: "empty-series" } };
  }
  const blocked = series.find((entry) => entry.unavailable || !Number.isFinite(entry.return));
  if (blocked) return { unavailable: blocked.unavailable ?? { code: "invalid-return", fromDate: blocked.date } };
  let product = 1;
  for (const entry of series) product *= 1 + entry.return;
  const cumulative = product - 1;
  const days = daysBetween(series[0].date, series.at(-1).date);
  return {
    cumulative,
    annualized:
      days < 365
        ? { unavailable: { code: "short-period", days } }
        : { value: (1 + cumulative) ** (365 / days) - 1 },
  };
}

function aggregateCashFlows(cashFlows) {
  const grouped = new Map();
  for (const [index, flow] of cashFlows.entries()) {
    if (!plainObject(flow) || !validDate(flow.date)) throw new Error(`cashFlows[${index}].date is invalid`);
    const amount = parseDecimal(flow.amount, `cashFlows[${index}].amount`, { maxScale: 8 });
    grouped.set(flow.date, add(grouped.get(flow.date) ?? ZERO, amount));
  }
  return [...grouped]
    .map(([date, amount]) => ({ date, amount: decimalNumber(amount) }))
    .filter((flow) => flow.amount !== 0)
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function xirr(cashFlows, options = {}) {
  if (!Array.isArray(cashFlows) || cashFlows.length === 0) return { unavailable: { code: "no-root" } };
  const flows = aggregateCashFlows(cashFlows);
  if (flows.length < 2 || !flows.some((flow) => flow.amount < 0) || !flows.some((flow) => flow.amount > 0)) {
    return { unavailable: { code: "no-root" } };
  }
  const origin = Date.parse(`${flows[0].date}T00:00:00Z`);
  const points = flows.map((flow) => ({
    amount: flow.amount,
    years: (Date.parse(`${flow.date}T00:00:00Z`) - origin) / DAY_MS / 365,
  }));
  if (!(points.at(-1).years > 0)) return { unavailable: { code: "no-root" } };
  const scale = Math.max(...points.map((point) => Math.abs(point.amount)), 1);
  const valueAt = (x) => points.reduce((total, point) => total + point.amount * Math.exp(-x * point.years), 0) / scale;
  const derivativeAt = (x) => points.reduce((total, point) => total - point.years * point.amount * Math.exp(-x * point.years), 0) / scale;
  const minimum = Math.log(1e-12);
  const maximum = Math.log(1 + 1e6);
  const steps = 8192;
  const brackets = [];
  const derivativeBrackets = [];
  let priorX = minimum;
  let priorValue = valueAt(priorX);
  let priorDerivative = derivativeAt(priorX);
  for (let index = 1; index <= steps; index += 1) {
    const x = minimum + ((maximum - minimum) * index) / steps;
    const value = valueAt(x);
    const derivative = derivativeAt(x);
    if (!Number.isFinite(value) || !Number.isFinite(derivative)) return { unavailable: { code: "non-convergent" } };
    if (priorValue === 0 || value === 0 || priorValue * value < 0) brackets.push([priorX, x]);
    if (priorDerivative === 0 || derivative === 0 || priorDerivative * derivative < 0) derivativeBrackets.push([priorX, x]);
    priorX = x;
    priorValue = value;
    priorDerivative = derivative;
  }
  if (options.maxIterations === 0 && brackets.length) return { unavailable: { code: "non-convergent" } };
  // Descartes/Laguerre rule for exponential sums: the number of real roots
  // (counted with multiplicity) is at most the number of sign changes in the
  // date-ordered flows and differs from it by an even number.
  let signChanges = 0;
  for (let index = 1; index < flows.length; index += 1) {
    if (Math.sign(flows[index].amount) !== Math.sign(flows[index - 1].amount)) signChanges += 1;
  }
  const maxIterations = Math.max(1, Math.floor(options.maxIterations ?? 256));
  const bisect = (bracket, fn) => {
    let [left, right] = bracket;
    let leftValue = fn(left);
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const middle = (left + right) / 2;
      const middleValue = fn(middle);
      if (Math.abs(middleValue) <= 1e-13 || right - left <= 1e-13) return middle;
      if (leftValue === 0 || leftValue * middleValue <= 0) right = middle;
      else {
        left = middle;
        leftValue = middleValue;
      }
    }
    return null;
  };
  const roots = [];
  const pushRoot = (root, multiplicity) => {
    if (!roots.some((candidate) => Math.abs(candidate.x - root) < 1e-8)) roots.push({ x: root, multiplicity });
  };
  const resolveRoot = (bracket) => {
    const root = bisect(bracket, valueAt);
    if (root == null || Math.abs(valueAt(root)) > 1e-10) return false;
    pushRoot(root, 1);
    return true;
  };
  for (const bracket of brackets) {
    if (!resolveRoot(bracket)) return { unavailable: { code: "non-convergent" } };
  }
  for (const bracket of derivativeBrackets) {
    const stationary = bisect(bracket, derivativeAt);
    if (stationary == null) return { unavailable: { code: "non-convergent" } };
    const residual = valueAt(stationary);
    if (Math.abs(residual) <= 1e-10) {
      pushRoot(stationary, 2);
      continue;
    }
    // The extremum has the opposite sign to both bracket ends: the coarse grid
    // stepped over a pair of roots, one on each side of the stationary point.
    if (valueAt(bracket[0]) * residual < 0 && valueAt(bracket[1]) * residual < 0) {
      for (const half of [[bracket[0], stationary], [stationary, bracket[1]]]) {
        if (!resolveRoot(half)) return { unavailable: { code: "non-convergent" } };
      }
    }
  }
  if (roots.length > 1) return { unavailable: { code: "multiple-roots", details: { count: roots.length } } };
  if (roots.length === 1) {
    const multiplicity = roots[0].multiplicity;
    if (signChanges >= 2 && (signChanges - multiplicity) % 2 !== 0) {
      // Parity proves at least one more real root exists (outside the supported
      // domain or between grid points); a unique value cannot be claimed.
      return { unavailable: { code: "multiple-roots", details: { count: roots.length, reason: "sign-change-parity" } } };
    }
    return { value: Math.expm1(roots[0].x) };
  }
  // No root inside the supported domain. An odd number of sign changes proves
  // an odd (non-zero) number of real roots, so every root lies outside [-1+1e-12, 1e6].
  if (signChanges % 2 === 1) return { unavailable: { code: "out-of-range" } };
  const beyond = valueAt(maximum + Math.log(2));
  const atMaximum = valueAt(maximum);
  if (Number.isFinite(beyond) && beyond * atMaximum < 0) return { unavailable: { code: "out-of-range" } };
  return { unavailable: { code: "no-root" } };
}

export function concentrationHHI(positionValues) {
  if (!Array.isArray(positionValues) || positionValues.length === 0) return { unavailable: { code: "no-positions" } };
  const grouped = new Map();
  try {
    for (const [index, position] of positionValues.entries()) {
      const value = parseDecimal(position.value, `positionValues[${index}].value`, { nonNegative: true, maxScale: 8 });
      grouped.set(position.instrumentId, add(grouped.get(position.instrumentId) ?? ZERO, value));
    }
  } catch {
    return { unavailable: { code: "invalid-position-value" } };
  }
  const positive = [...grouped].filter(([, value]) => compare(value, ZERO) > 0);
  const total = sum(positive.map(([, value]) => value));
  if (positive.length === 0 || compare(total, ZERO) <= 0) return { unavailable: { code: "non-positive-securities-value" } };
  const totalNumber = decimalNumber(total);
  const weights = Object.fromEntries(positive.map(([id, value]) => [id, decimalNumber(value) / totalNumber]));
  const raw = Object.values(weights).reduce((result, weight) => result + weight * weight, 0);
  const count = positive.length;
  return { raw, normalized: count === 1 ? 1 : (raw - 1 / count) / (1 - 1 / count), count, weights };
}

function endingMarketValues(state, marketInputs, checkpointFx, endingDate) {
  const byPosition = new Map();
  for (const position of state.positions.values()) {
    if (compare(position.quantity, ZERO) <= 0) continue;
    const instrument = state.instruments.get(position.instrumentId);
    const source = marketInputs.prices?.[position.instrumentId];
    if (validateRawSource(instrument, source)) {
      return {
        unavailable: {
          code: "missing-raw-data",
          fromDate: endingDate,
          details: { path: source?.path ?? `data/market-raw/${instrument.symbol}.csv`, instrumentId: position.instrumentId },
        },
      };
    }
    const selected = selectObservation(endingDate, source.observations, { market: instrument.market, syncedAt: source.sidecar.syncedAt });
    if (!selected) {
      return {
        unavailable: {
          code: "missing-raw-data",
          fromDate: endingDate,
          details: { path: source.path, instrumentId: position.instrumentId },
        },
      };
    }
    const local = multiply(position.quantity, parseDecimal(selected.observation.close, "close", { positive: true, maxScale: 8 }));
    const fx = fxFor({ checkpointFx }, endingDate, instrument.currency, { allowMissing: true });
    if (!fx) {
      return {
        unavailable: { code: "missing-fx", reason: "missing-fx", fromDate: endingDate, details: { instrumentId: position.instrumentId } },
      };
    }
    byPosition.set(positionKey(position.accountId, position.instrumentId), { local, fx, base: multiply(local, fx) });
  }
  return { byPosition, unavailable: null };
}

// Strict metrics (XIRR, attribution) need every checkpoint's value and flows.
// The first blocking checkpoint decides the structured reason.
function blockingUnavailable(series, marketInputs) {
  const checkpoint = series.checkpoints.find((entry) => entry.unavailable);
  if (checkpoint) {
    const { code, fromDate, details } = checkpoint.unavailable;
    return {
      unavailable: {
        code,
        ...(code === "missing-fx" ? { reason: "missing-fx" } : {}),
        fromDate,
        ...(details ? { details } : {}),
      },
    };
  }
  if (series.state.baseUnavailable) {
    return {
      unavailable: {
        code: "missing-fx",
        reason: "missing-fx",
        fromDate: series.state.baseUnavailable.date ?? marketInputs.startDate,
      },
    };
  }
  return null;
}

export function currencyAttribution(ledger, marketInputs) {
  const series = portfolioValueSeries(ledger, marketInputs);
  const blocked = blockingUnavailable(series, marketInputs);
  if (blocked) return blocked;
  const endingDate = marketInputs.endDate;
  const state = series.state;
  const ending = endingMarketValues(state, marketInputs, series.checkpointFx, endingDate);
  if (ending.unavailable) return { unavailable: ending.unavailable };
  const endingValues = ending.byPosition;
  const byInstrumentInternal = new Map();
  for (const position of state.positions.values()) {
    const ending = endingValues.get(positionKey(position.accountId, position.instrumentId));
    let local = position.localContributionBase;
    let fx = position.fxContributionBase;
    if (ending) {
      local = add(local, multiply(subtract(ending.local, position.costBasisLocal), ending.fx));
      fx = add(fx, subtract(multiply(position.costBasisLocal, ending.fx), position.costBasisBase));
    }
    const current = byInstrumentInternal.get(position.instrumentId) ?? { localPrice: ZERO, fx: ZERO };
    current.localPrice = add(current.localPrice, local);
    current.fx = add(current.fx, fx);
    byInstrumentInternal.set(position.instrumentId, current);
  }
  const byInstrument = Object.fromEntries(
    [...byInstrumentInternal].map(([id, value]) => [id, { localPrice: moneyString(value.localPrice), fx: moneyString(value.fx) }]),
  );
  const localPrice = sum([...byInstrumentInternal.values()].map((value) => value.localPrice));
  const instrumentFx = sum([...byInstrumentInternal.values()].map((value) => value.fx));
  const netIncome = sum([...state.positions.values()].map((position) => position.netIncomeBase));
  let endingUsd = ZERO;
  for (const currencies of state.cash.values()) endingUsd = add(endingUsd, currencies.get("USD") ?? ZERO);
  for (const receivable of state.receivables.values()) if (receivable.currency === "USD" && !receivable.paid) endingUsd = add(endingUsd, receivable.amount);
  // FX is a dependency of non-zero exposure only: a zero ending USD balance
  // contributes 0 x FX, so a pure-CNY ledger must not demand a USDCNY source.
  const endingUsdBase =
    compare(endingUsd, ZERO) === 0
      ? ZERO
      : multiply(endingUsd, fxFor({ checkpointFx: series.checkpointFx }, endingDate, "USD"));
  const cashFx = subtract(endingUsdBase, state.cashReferenceBase);
  const externalFlowSum = sum(state.externalFlows.map((flow) => flow.amount));
  const endingValue = parseDecimal(series.checkpoints.at(-1).value, "endingValue", { maxScale: 2 });
  const economicPnl = subtract(endingValue, externalFlowSum);
  const identityComponents = add(add(add(add(localPrice, instrumentFx), netIncome), cashFx), state.conversionSpread);
  const identityDifference = subtract(economicPnl, identityComponents);
  return {
    externalFlowSum: moneyString(externalFlowSum),
    economicPnl: moneyString(economicPnl),
    localPrice: moneyString(localPrice),
    instrumentFx: moneyString(instrumentFx),
    netIncome: moneyString(netIncome),
    cashFx: moneyString(cashFx),
    conversionSpread: moneyString(state.conversionSpread),
    identityDifference: moneyString(identityDifference),
    byInstrument,
  };
}

function xirrFlowsFromSeries(series) {
  const grouped = new Map();
  for (const flow of series.state.externalFlows) grouped.set(flow.date, subtract(grouped.get(flow.date) ?? ZERO, flow.amount));
  const end = series.checkpoints.at(-1);
  grouped.set(end.date, add(grouped.get(end.date) ?? ZERO, parseDecimal(end.value, "end.value", { maxScale: 2 })));
  return [...grouped].map(([date, amount]) => ({ date, amount: moneyString(amount) }));
}

export function analyzePortfolio({ ledger, marketInputs }) {
  const series = portfolioValueSeries(ledger, marketInputs);
  const twr = timeWeightedReturn(series.checkpoints);
  const rules = [];
  if (series.audit.largeJumps.length) {
    rules.push({ id: "suspected-missing-corporate-action", category: "static-audit", priority: 0, values: series.audit.largeJumps });
  }
  if (series.checkpoints.some((checkpoint) => checkpoint.provisional)) {
    rules.push({ id: "provisional-checkpoints", category: "static-audit", priority: 0, values: {} });
  }
  const endingDate = marketInputs.endDate;
  const ending = endingMarketValues(series.state, marketInputs, series.checkpointFx, endingDate);
  let hhi;
  let exposure;
  if (ending.unavailable) {
    hhi = { unavailable: ending.unavailable };
    exposure = { unavailable: ending.unavailable };
  } else {
    const byInstrument = new Map();
    const byAccount = new Map();
    for (const [key, value] of ending.byPosition) {
      const [accountId, instrumentId] = key.split("\u0000");
      byInstrument.set(instrumentId, add(byInstrument.get(instrumentId) ?? ZERO, value.base));
      byAccount.set(accountId, add(byAccount.get(accountId) ?? ZERO, value.base));
    }
    hhi = concentrationHHI(
      [...byInstrument].map(([instrumentId, value]) => ({ instrumentId, value: decimalString(value) })),
    );
    if (hhi.unavailable) {
      exposure = { unavailable: hhi.unavailable };
    } else {
      const securitiesTotal = sum([...byInstrument.values()]);
      const weight = (value) => decimalNumber(value) / decimalNumber(securitiesTotal);
      exposure = {
        byInstrument: [...byInstrument]
          .map(([instrumentId, value]) => ({
            instrumentId,
            symbol: series.state.instruments.get(instrumentId)?.symbol ?? instrumentId,
            valueBase: moneyString(value),
            weight: weight(value),
          }))
          .sort((left, right) => left.symbol.localeCompare(right.symbol)),
        byAccount: [...byAccount]
          .map(([accountId, value]) => ({
            accountId,
            valueBase: moneyString(value),
            weight: weight(value),
          }))
          .sort((left, right) => left.accountId.localeCompare(right.accountId)),
      };
    }
  }
  const blocked = blockingUnavailable(series, marketInputs);
  if (blocked) {
    return {
      summary: {
        twr,
        xirr: blocked,
        hhi: ending.unavailable ? blocked : hhi,
        exposure: ending.unavailable ? { unavailable: blocked.unavailable } : exposure,
        attribution: blocked,
      },
      series: series.checkpoints,
      rules,
    };
  }
  const xirrResult = xirr(xirrFlowsFromSeries(series));
  const attribution = currencyAttribution(ledger, marketInputs);
  return {
    summary: { twr, xirr: xirrResult, hhi, exposure, attribution },
    series: series.checkpoints,
    rules,
  };
}

const HOLDINGS_FIELDS = new Set([
  "format",
  "version",
  "derivedAt",
  "transactionsFingerprint",
  "inputsFingerprint",
  "baseCurrency",
  "valuation",
  "cashByAccount",
  "positionsByAccount",
  "aggregateByInstrument",
  "warnings",
  "availability",
]);
const HOLDINGS_POSITION_FIELDS = new Set([
  "accountId",
  "instrumentId",
  "quantity",
  "avgCostLocal",
  "costBasisLocal",
  "avgCostBase",
  "costBasisBase",
  "realizedPnlLocal",
  "realizedPnlBase",
  "netIncomeLocal",
  "netIncomeBase",
  "unrealizedPnlLocal",
  "unrealizedPnlBase",
  "firstBuyDate",
  "baseUnavailable",
]);
const HOLDINGS_AGGREGATE_FIELDS = new Set([
  "instrumentId",
  "quantity",
  "costBasisLocal",
  "costBasisBase",
  "baseUnavailable",
]);

function validMissingFxUnavailable(value) {
  return (
    plainObject(value) &&
    value.code === "missing-fx" &&
    value.reason === "missing-fx" &&
    Object.keys(value).every((key) => key === "code" || key === "reason")
  );
}

function validValuationUnavailable(value) {
  return (
    plainObject(value) &&
    (value.code === "missing-fx" || value.code === "missing-raw-data") &&
    value.reason === value.code &&
    Object.keys(value).every((key) => key === "code" || key === "reason")
  );
}

function holdingsDecimal(value, path, issues, options = {}) {
  try {
    parseDecimal(value, path, options);
  } catch (error) {
    if (error instanceof DecimalIssue) issues.push({ path: error.path, code: error.code, message: error.message });
    else throw error;
  }
}

export function parseHoldings(sourceText) {
  let value;
  try {
    value = JSON.parse(sourceText);
  } catch {
    throw new PortfolioValidationError([{ path: "$", code: "invalid-json", message: "holdings is not valid JSON" }]);
  }
  const issues = [];
  if (!plainObject(value)) issues.push({ path: "$", code: "object-required", message: "holdings must be an object" });
  else {
    unknownFields(value, HOLDINGS_FIELDS, "$", issues);
    if (value.format !== "codeshell.portfolio-holdings") issues.push({ path: "format", code: "invalid-format", message: "unexpected holdings format" });
    if (value.version !== 1) issues.push({ path: "version", code: "unsupported-version", message: "only holdings version 1 is supported" });
    if (value.baseCurrency !== "CNY") issues.push({ path: "baseCurrency", code: "unsupported-base-currency", message: "base currency must be CNY" });
    if (typeof value.transactionsFingerprint !== "string" || !/^fnv1a32:[0-9a-f]{8}$/u.test(value.transactionsFingerprint)) issues.push({ path: "transactionsFingerprint", code: "invalid-fingerprint", message: "fingerprint is invalid" });
    if (typeof value.derivedAt !== "string" || Number.isNaN(Date.parse(value.derivedAt))) issues.push({ path: "derivedAt", code: "invalid-instant", message: "derivedAt is invalid" });
    if (
      Object.prototype.hasOwnProperty.call(value, "inputsFingerprint") &&
      (typeof value.inputsFingerprint !== "string" || !/^fnv1a32:[0-9a-f]{8}$/u.test(value.inputsFingerprint))
    ) {
      issues.push({ path: "inputsFingerprint", code: "invalid-fingerprint", message: "inputs fingerprint is invalid" });
    }
    if (!plainObject(value.cashByAccount)) issues.push({ path: "cashByAccount", code: "object-required", message: "cashByAccount is required" });
    else for (const [accountId, currencies] of Object.entries(value.cashByAccount)) {
      if (!plainObject(currencies)) issues.push({ path: `cashByAccount.${accountId}`, code: "object-required", message: "currency map is required" });
      else for (const [currency, amount] of Object.entries(currencies)) {
        if (!CURRENCIES.has(currency)) issues.push({ path: `cashByAccount.${accountId}.${currency}`, code: "unsupported-currency", message: "unsupported currency" });
        holdingsDecimal(amount, `cashByAccount.${accountId}.${currency}`, issues, { maxScale: 2 });
      }
    }
    required(value, ["availability"], "$", issues);
    let baseStatusComplete = null;
    if (Object.prototype.hasOwnProperty.call(value, "availability")) {
      const availability = value.availability;
      if (!plainObject(availability)) {
        issues.push({ path: "availability", code: "object-required", message: "availability must be an object" });
      } else {
        unknownFields(availability, new Set(["local", "base"]), "availability", issues);
        if (availability.local?.status !== "complete") {
          issues.push({ path: "availability.local.status", code: "invalid-status", message: "local availability must be complete" });
        }
        const base = availability.base;
        if (
          !plainObject(base) ||
          !(
            (base.status === "complete" && Object.keys(base).length === 1) ||
            (base.status === "unavailable" &&
              base.reason === "missing-fx" &&
              Object.keys(base).every((key) => key === "status" || key === "reason"))
          )
        ) {
          issues.push({ path: "availability.base", code: "invalid-status", message: "base availability is invalid" });
        } else {
          baseStatusComplete = base.status === "complete";
        }
      }
    }
    let anyBaseUnavailableMarker = false;
    if (!Array.isArray(value.positionsByAccount)) issues.push({ path: "positionsByAccount", code: "array-required", message: "positions must be an array" });
    else {
      const keys = new Set();
      for (const [index, position] of value.positionsByAccount.entries()) {
        const path = `positionsByAccount[${index}]`;
        if (!plainObject(position)) {
          issues.push({ path, code: "object-required", message: "position must be an object" });
          continue;
        }
        unknownFields(position, HOLDINGS_POSITION_FIELDS, path, issues);
        required(position, [
          "accountId", "instrumentId", "quantity", "avgCostLocal", "costBasisLocal",
          "avgCostBase", "costBasisBase", "realizedPnlLocal", "realizedPnlBase",
          "netIncomeLocal", "netIncomeBase", "firstBuyDate",
        ], path, issues);
        const key = `${position.accountId}\u0000${position.instrumentId}`;
        if (keys.has(key)) issues.push({ path, code: "duplicate-position", message: "account/instrument position is duplicated" });
        keys.add(key);
        holdingsDecimal(position.quantity, `${path}.quantity`, issues, { nonNegative: true, maxScale: 12 });
        const positionBaseUnavailable = validMissingFxUnavailable(position.baseUnavailable);
        if (positionBaseUnavailable) anyBaseUnavailableMarker = true;
        if (
          Object.prototype.hasOwnProperty.call(position, "baseUnavailable") &&
          !positionBaseUnavailable
        ) {
          issues.push({ path: `${path}.baseUnavailable`, code: "invalid-unavailable", message: "base unavailable reason is invalid" });
        }
        for (const field of [
          "avgCostLocal", "costBasisLocal", "avgCostBase", "costBasisBase",
          "realizedPnlLocal", "realizedPnlBase", "netIncomeLocal", "netIncomeBase",
          "unrealizedPnlLocal", "unrealizedPnlBase",
        ]) {
          if (Object.prototype.hasOwnProperty.call(position, field)) {
            const baseField = field.endsWith("Base");
            if (position[field] === null && baseField && positionBaseUnavailable) continue;
            holdingsDecimal(position[field], `${path}.${field}`, issues, { maxScale: field.startsWith("avg") ? 12 : 2 });
          }
        }
        if (position.firstBuyDate !== null && !validDate(position.firstBuyDate)) {
          issues.push({ path: `${path}.firstBuyDate`, code: "invalid-date", message: "firstBuyDate is invalid" });
        }
      }
    }
    if (!Array.isArray(value.aggregateByInstrument)) issues.push({ path: "aggregateByInstrument", code: "array-required", message: "aggregate must be an array" });
    else {
      const ids = new Set();
      for (const [index, aggregate] of value.aggregateByInstrument.entries()) {
        const path = `aggregateByInstrument[${index}]`;
        if (!plainObject(aggregate)) {
          issues.push({ path, code: "object-required", message: "aggregate must be an object" });
          continue;
        }
        unknownFields(aggregate, HOLDINGS_AGGREGATE_FIELDS, path, issues);
        required(
          aggregate,
          [...HOLDINGS_AGGREGATE_FIELDS].filter((field) => field !== "baseUnavailable"),
          path,
          issues,
        );
        if (ids.has(aggregate.instrumentId)) issues.push({ path: `${path}.instrumentId`, code: "duplicate-id", message: "aggregate instrument is duplicated" });
        ids.add(aggregate.instrumentId);
        const aggregateBaseUnavailable = validMissingFxUnavailable(aggregate.baseUnavailable);
        if (aggregateBaseUnavailable) anyBaseUnavailableMarker = true;
        if (
          Object.prototype.hasOwnProperty.call(aggregate, "baseUnavailable") &&
          !aggregateBaseUnavailable
        ) {
          issues.push({ path: `${path}.baseUnavailable`, code: "invalid-unavailable", message: "base unavailable reason is invalid" });
        }
        holdingsDecimal(aggregate.quantity, `${path}.quantity`, issues, { nonNegative: true, maxScale: 12 });
        holdingsDecimal(aggregate.costBasisLocal, `${path}.costBasisLocal`, issues, { maxScale: 2 });
        if (!(aggregate.costBasisBase === null && aggregateBaseUnavailable)) {
          holdingsDecimal(aggregate.costBasisBase, `${path}.costBasisBase`, issues, { maxScale: 2 });
        }
      }
    }
    if (!Array.isArray(value.warnings)) issues.push({ path: "warnings", code: "array-required", message: "warnings must be an array" });
    // Partial degradation must be expressed consistently: a position-level
    // missing-fx marker cannot coexist with a complete top-level base status.
    if (baseStatusComplete === true && anyBaseUnavailableMarker) {
      issues.push({ path: "availability.base", code: "inconsistent-availability", message: "base is complete but a position reports missing-fx" });
    }
    if (Object.prototype.hasOwnProperty.call(value, "valuation")) {
      const valuation = value.valuation;
      if (!plainObject(valuation)) {
        issues.push({ path: "valuation", code: "object-required", message: "valuation must be an object" });
      } else {
        unknownFields(valuation, new Set(["endingDate", "totalBase", "unavailable"]), "valuation", issues);
        required(valuation, ["endingDate", "totalBase"], "valuation", issues);
        if (!validDate(valuation.endingDate)) issues.push({ path: "valuation.endingDate", code: "invalid-date", message: "endingDate is invalid" });
        const hasUnavailable = Object.prototype.hasOwnProperty.call(valuation, "unavailable");
        if (hasUnavailable && !validValuationUnavailable(valuation.unavailable)) {
          issues.push({ path: "valuation.unavailable", code: "invalid-unavailable", message: "valuation unavailable reason is invalid" });
        }
        if (valuation.totalBase === null) {
          if (!hasUnavailable) issues.push({ path: "valuation.unavailable", code: "required", message: "a null total needs a structured reason" });
        } else if (Object.prototype.hasOwnProperty.call(valuation, "totalBase")) {
          holdingsDecimal(valuation.totalBase, "valuation.totalBase", issues, { maxScale: 2 });
          if (hasUnavailable) issues.push({ path: "valuation", code: "inconsistent-availability", message: "a total and an unavailable reason cannot coexist" });
          if (baseStatusComplete === false) issues.push({ path: "valuation.totalBase", code: "inconsistent-availability", message: "base is unavailable but a total is reported" });
        }
      }
    }
  }
  if (issues.length) throw new PortfolioValidationError(issues);
  return value;
}
