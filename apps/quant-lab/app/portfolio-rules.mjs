/*
 * Deterministic P0-P3 portfolio judgements.
 *
 * Inputs are already-computed portfolio evidence. This module has no DOM,
 * Host, storage, network or agent dependency: it only classifies facts and
 * returns display-ready numbers/conditions. Agent callers may explain the
 * result, but must never replace these calculations.
 */

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

export const PORTFOLIO_RULE_THRESHOLDS = deepFreeze({
  "stale-quotes": {
    withinMarketFreshnessWindow: true,
  },
  "ledger-fingerprint-mismatch": { fingerprintsEqual: true },
  "missing-raw-data": { unavailableSources: 0, maximumObservationAgeCalendarDays: 10 },
  "suspected-missing-corporate-action": { absoluteDailyChange: 0.35 },
  "fx-source-divergence": { relativeDifference: 0.01, operator: ">" },
  "provisional-checkpoints": { count: 0 },
  // The bins are a product heuristic for describing normalized HHI (0 = equal
  // weights, 1 = single position). They are not an industry standard and carry
  // no good/bad judgement (PRD §8.4, §10): the rule never turns "warning".
  "concentration-band": { middleFrom: 0.25, higherFrom: 0.5, basis: "product-heuristic" },
  "position-weight-extremes": { positiveWeight: 0, targetWeight: null },
  "pnl-contributors": { neutralAmountBase: "0.00" },
  "return-method-gap": { minimumAnnualizedHistoryCalendarDays: 365 },
  "decision-outcomes": {
    categories: ["met", "partial", "missed", "undecidable", "notDue", "reviewDue"],
  },
  "review-due": { count: 0 },
  "alerts-triggered": { count: 0 },
});

const RULE_SPECS = deepFreeze({
  "stale-quotes": { name: "报价新鲜度", priority: "P0", priorityRank: 0, severity: "high", verificationLevel: "static-audit" },
  "ledger-fingerprint-mismatch": { name: "账本指纹一致性", priority: "P0", priorityRank: 0, severity: "high", verificationLevel: "static-audit" },
  "missing-raw-data": { name: "未复权行情完整性", priority: "P0", priorityRank: 0, severity: "critical", verificationLevel: "static-audit" },
  "suspected-missing-corporate-action": { name: "疑似漏录公司行动", priority: "P0", priorityRank: 0, severity: "critical", verificationLevel: "static-audit" },
  "fx-source-divergence": { name: "汇率校验源分歧", priority: "P0", priorityRank: 0, severity: "medium", verificationLevel: "static-audit" },
  "provisional-checkpoints": { name: "暂定检查点", priority: "P0", priorityRank: 0, severity: "info", verificationLevel: "static-audit" },
  "concentration-band": { name: "归一化 HHI 分箱", priority: "P1", priorityRank: 1, severity: "medium", verificationLevel: "historically-recomputable" },
  "position-weight-extremes": { name: "持仓与账户权重极值", priority: "P1", priorityRank: 1, severity: "info", verificationLevel: "historically-recomputable" },
  "pnl-contributors": { name: "盈亏贡献", priority: "P2", priorityRank: 2, severity: "medium", verificationLevel: "historically-recomputable" },
  "return-method-gap": { name: "收益口径差", priority: "P2", priorityRank: 2, severity: "info", verificationLevel: "historically-recomputable" },
  "decision-outcomes": { name: "决策记录结果", priority: "P2", priorityRank: 2, severity: "info", verificationLevel: "historically-recomputable" },
  "review-due": { name: "到期未复盘", priority: "P3", priorityRank: 3, severity: "medium", verificationLevel: "historically-recomputable" },
  "alerts-triggered": { name: "关注规则触发", priority: "P3", priorityRank: 3, severity: "info", verificationLevel: "historically-recomputable" },
});

const SEVERITY_RANK = deepFreeze({ critical: 0, high: 1, medium: 2, info: 3 });

/*
 * Deterministic order for choosing the primary reason when several
 * dependencies are missing at once. Shared codes keep the same relative order
 * as the engine's checkpoint ranking (missing-fx, missing-raw-data, ages,
 * suspected corporate action, negative-cash, non-positive-equity); the rule
 * layer only puts the reader-level contract conflict first and history /
 * provisional / stale last. Every distinct reason is still preserved in
 * `unavailable.reasons`; unknown codes sort after the known ones by name.
 */
export const UNAVAILABLE_REASON_PRIORITY = deepFreeze([
  "raw-contract-conflict",
  "missing-fx",
  "missing-raw-data",
  "price-age-exceeded",
  "fx-age-exceeded",
  "suspected-missing-corporate-action",
  "negative-cash",
  "non-positive-equity",
  "no-root",
  "multiple-roots",
  "out-of-range",
  "non-convergent",
  "insufficient-history",
  "no-positions",
  "provisional",
  "stale",
]);

function reasonRank(reason) {
  const index = UNAVAILABLE_REASON_PRIORITY.indexOf(reason);
  return index === -1 ? UNAVAILABLE_REASON_PRIORITY.length : index;
}

function orderReasons(reasons) {
  const distinct = [...new Set(list(reasons).filter((reason) => typeof reason === "string" && reason))];
  return distinct.sort((left, right) => reasonRank(left) - reasonRank(right) || left.localeCompare(right));
}

function plainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function text(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function statusEnvelope(value) {
  return plainObject(value) ? value : {};
}

function unavailableReason(value, fallback) {
  if (typeof value === "string" && value) return value;
  if (plainObject(value)) {
    if (typeof value.reason === "string" && value.reason) return value.reason;
    if (typeof value.code === "string" && value.code) return value.code;
    if (plainObject(value.unavailable)) return unavailableReason(value.unavailable, fallback);
  }
  return fallback;
}

function subjectsFrom(items) {
  const result = [];
  const seen = new Set();
  for (const item of list(items)) {
    const symbol = text(item?.symbol, text(item?.instrumentId));
    const account = text(item?.account, text(item?.accountId));
    if (!symbol && !account) continue;
    const key = `${symbol}\u0000${account}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ symbol, account });
  }
  return result.sort(
    (left, right) =>
      left.symbol.localeCompare(right.symbol) || left.account.localeCompare(right.account),
  );
}

function dataFrom(items, context, overrides = {}) {
  const values = list(items);
  const sources = [...new Set(values.map((item) => text(item?.source)).filter(Boolean))].sort();
  const availableAt = values
    .map((item) => text(item?.availableAt))
    .filter(Boolean)
    .sort()
    .at(-1) ?? text(context?.asOf, null);
  return {
    source: sources.join(" + ") || text(overrides.source, "portfolio-engine"),
    availableAt: overrides.availableAt ?? availableAt,
    stale: overrides.stale ?? (values.length ? values.some((item) => item?.stale === true) : false),
    provisional:
      overrides.provisional ??
      (values.length ? values.some((item) => item?.provisional === true) : false),
  };
}

function makeRule(id, context, {
  status,
  condition,
  actual,
  threshold = PORTFOLIO_RULE_THRESHOLDS[id],
  items = [],
  data,
  unavailable,
  baseline,
  limitations = [],
}) {
  const spec = RULE_SPECS[id];
  const subjects = subjectsFrom(items);
  return {
    id,
    name: spec.name,
    priority: spec.priority,
    priorityRank: spec.priorityRank,
    severity: spec.severity,
    severityRank: SEVERITY_RANK[spec.severity],
    status,
    condition,
    actual,
    threshold,
    verificationLevel: spec.verificationLevel,
    asOf: text(context?.asOf, null),
    inputFingerprint: text(context?.inputFingerprint, null),
    subjects,
    sortSymbol: subjects[0]?.symbol ?? "",
    sortAccount: subjects[0]?.account ?? "",
    data: data ?? dataFrom(items, context),
    baseline: baseline ?? null,
    limitations,
    ...(unavailable ? { unavailable } : {}),
  };
}

function unavailableRule(id, context, reason, options = {}) {
  // `reason` may be a single code or a list; the primary reason is always the
  // highest-priority distinct code and the full ordered list is kept.
  const reasons = orderReasons(Array.isArray(reason) ? reason : [reason]);
  if (reasons.length === 0) reasons.push("unavailable");
  return makeRule(id, context, {
    status: "unavailable",
    condition: options.condition ?? "依赖证据可用时才能判断",
    actual: null,
    threshold: options.threshold,
    items: options.items,
    data: options.data,
    baseline: options.baseline,
    limitations: options.limitations ?? [],
    unavailable: {
      reason: reasons[0],
      reasons,
      ...(options.details === undefined ? {} : { details: options.details }),
      ...(options.upstreamCode === undefined ? {} : { upstreamCode: options.upstreamCode }),
    },
  });
}

function metricUnavailable(metric) {
  if (!plainObject(metric)) return { reason: "metric-unavailable" };
  if (plainObject(metric.unavailable)) {
    return {
      reason: unavailableReason(metric.unavailable, "metric-unavailable"),
      details: metric.unavailable.details,
    };
  }
  return null;
}

function rawItemBlocked(item) {
  return (
    item?.status !== "available" ||
    (Number.isFinite(Number(item?.ageCalendarDays)) &&
      Number(item.ageCalendarDays) >
        PORTFOLIO_RULE_THRESHOLDS["missing-raw-data"].maximumObservationAgeCalendarDays)
  );
}

function rawItemReason(item) {
  return item?.status === "available"
    ? "price-age-exceeded"
    : unavailableReason(item, "missing-raw-data");
}

// Every raw source that cannot feed a market-value dependent rule, with its own
// reason. Callers merge these with the engine's reason instead of picking one.
function rawDependencyBlocks(context) {
  const raw = statusEnvelope(context.raw);
  if (raw.status === "unavailable" || raw.status === "error") {
    return [{ symbol: "", account: "", reason: unavailableReason(raw, "raw-inventory-unavailable") }];
  }
  return list(raw.items)
    .filter(rawItemBlocked)
    .map((item) => ({
      symbol: text(item?.symbol, text(item?.instrumentId)),
      account: text(item?.account, text(item?.accountId)),
      reason: rawItemReason(item),
    }))
    .sort(
      (left, right) =>
        left.symbol.localeCompare(right.symbol) || left.account.localeCompare(right.account),
    );
}

function evaluateStaleQuotes(analysis, context) {
  const quotes = statusEnvelope(context.quotes);
  if (quotes.status === "unavailable" || quotes.status === "error") {
    return unavailableRule("stale-quotes", context, unavailableReason(quotes, "quote-data-unavailable"), {
      items: quotes.items,
    });
  }
  if (quotes.status !== "available" || !Array.isArray(quotes.items)) {
    return unavailableRule("stale-quotes", context, "quote-data-unavailable");
  }
  const stale = quotes.items.filter(
    (item) => item?.stale === true || item?.status === "stale",
  );
  return makeRule("stale-quotes", context, {
    status: stale.length ? "warning" : "positive",
    condition: "每个标的的最新报价都在对应市场的有效时限内",
    actual: { staleCount: stale.length, items: stale },
    items: stale.length ? stale : quotes.items,
    baseline: { staleCount: 0 },
    limitations: ["逐一按报价时间判断；整体同步时间不能掩盖某个标的的旧报价"],
  });
}

function evaluateFingerprint(analysis, context) {
  const ledger = statusEnvelope(context.ledger);
  if (ledger.status === "unavailable" || ledger.status === "error") {
    return unavailableRule(
      "ledger-fingerprint-mismatch",
      context,
      unavailableReason(ledger, "ledger-state-unavailable"),
    );
  }
  if (ledger.status !== "verified") {
    return unavailableRule("ledger-fingerprint-mismatch", context, "ledger-state-unavailable");
  }
  const mismatch =
    ledger.mismatchObserved === true ||
    !ledger.currentFingerprint ||
    !ledger.holdingsFingerprint ||
    ledger.currentFingerprint !== ledger.holdingsFingerprint;
  return makeRule("ledger-fingerprint-mismatch", context, {
    status: mismatch ? "warning" : "positive",
    condition: "持仓快照所对应的交易记录与当前交易记录一致",
    actual: {
      equal: !mismatch,
      currentFingerprint: ledger.currentFingerprint ?? null,
      holdingsFingerprint: ledger.holdingsFingerprint ?? null,
      mismatchObserved: ledger.mismatchObserved === true,
    },
    baseline: { equal: true },
    limitations: ["持仓快照可以重新生成；记录不一致时会保留提示，并使用重新计算的结果"],
  });
}

function evaluateRawCompleteness(analysis, context) {
  const raw = statusEnvelope(context.raw);
  if (raw.status === "unavailable" || raw.status === "error") {
    return unavailableRule(
      "missing-raw-data",
      context,
      unavailableReason(raw, "raw-inventory-unavailable"),
      { items: raw.items },
    );
  }
  if (raw.status !== "available" || !Array.isArray(raw.items)) {
    return unavailableRule("missing-raw-data", context, "raw-inventory-unavailable");
  }
  const missing = raw.items
    .filter(rawItemBlocked)
    .map((item) =>
      item?.status === "available"
        ? { ...item, status: "unavailable", reason: "price-age-exceeded" }
        : item,
    )
    .sort(
      (left, right) =>
        text(left?.symbol, text(left?.instrumentId)).localeCompare(
          text(right?.symbol, text(right?.instrumentId)),
        ) ||
        text(left?.account, text(left?.accountId)).localeCompare(
          text(right?.account, text(right?.accountId)),
        ),
    );
  return makeRule("missing-raw-data", context, {
    status: missing.length ? "warning" : "positive",
    condition: "每个持仓都有来源、用途、复权口径和版本一致的未复权行情",
    actual: {
      unavailableSources: missing.length,
      items: missing.map((item) => ({
        symbol: text(item.symbol),
        account: text(item.account),
        reason: unavailableReason(item, "missing-raw-data"),
      })),
    },
    items: missing.length ? missing : raw.items,
    baseline: { unavailableSources: 0 },
    limitations: ["用于研究的复权行情不能替代持仓估值所需的未复权行情"],
  });
}

function evaluateCorporateAction(analysis, context) {
  const audit = statusEnvelope(context.corporateActionAudit);
  if (audit.status === "unavailable" || audit.status === "error") {
    return unavailableRule(
      "suspected-missing-corporate-action",
      context,
      unavailableReason(audit, "audit-data-unavailable"),
    );
  }
  if (audit.status !== "available") {
    return unavailableRule("suspected-missing-corporate-action", context, "audit-data-unavailable");
  }
  const finding = list(analysis?.rules).find(
    (entry) => entry?.id === "suspected-missing-corporate-action",
  );
  const values = list(finding?.values)
    .slice()
    .sort(
      (left, right) =>
        text(left?.symbol, text(left?.instrumentId)).localeCompare(
          text(right?.symbol, text(right?.instrumentId)),
        ) ||
        text(left?.account, text(left?.accountId)).localeCompare(
          text(right?.account, text(right?.accountId)),
        ) ||
        text(left?.date).localeCompare(text(right?.date)),
    );
  // The engine skips positions whose raw source is unreadable, so those
  // positions were never audited. "No jump found" must not cover them.
  const unaudited = rawDependencyBlocks(context)
    .filter((block) => block.symbol)
    .map((block) => ({ symbol: block.symbol, reason: block.reason }));
  const limitations = ["启发式只能指出疑点，不能证明公司行动"];
  if (unaudited.length) {
    limitations.push(
      `未审计标的（raw 不可读）：${unaudited.map((entry) => `${entry.symbol}(${entry.reason})`).join("、")}`,
    );
  }
  if (values.length === 0 && unaudited.length) {
    return unavailableRule(
      "suspected-missing-corporate-action",
      context,
      unaudited.map((entry) => entry.reason),
      {
        details: { unaudited: unaudited.map((entry) => entry.symbol) },
        items: unaudited,
        limitations,
      },
    );
  }
  return makeRule("suspected-missing-corporate-action", context, {
    status: values.length ? "warning" : "positive",
    condition: "附近没有已记录的公司行动，且未复权价格单日变化达到 35%",
    actual: { count: values.length, items: values, unaudited },
    items: values,
    baseline: { count: 0 },
    limitations,
  });
}

function evaluateFxDivergence(analysis, context) {
  const verification = statusEnvelope(context.fxVerification);
  if (!context.fxVerification || verification.status === "not-available") {
    return makeRule("fx-source-divergence", context, {
      status: "neutral",
      condition: "同日 Yahoo 与欧洲央行汇率的相对差异超过 1%",
      actual: { available: false },
      data: dataFrom([], context, { source: "fx-verification not available" }),
      limitations: ["ECB 校验文件缺失时不触发；核算源仍固定为 Yahoo"],
    });
  }
  if (verification.status === "error" || verification.status === "unavailable") {
    return unavailableRule(
      "fx-source-divergence",
      context,
      unavailableReason(verification, "fx-verification-invalid"),
      { data: dataFrom([verification], context) },
    );
  }
  const yahoo = Number(verification.yahoo);
  const ecb = Number(verification.ecb);
  if (!Number.isFinite(yahoo) || !Number.isFinite(ecb) || ecb <= 0) {
    return unavailableRule("fx-source-divergence", context, "fx-verification-invalid", {
      data: dataFrom([verification], context),
    });
  }
  const relativeDifference = Math.abs(yahoo - ecb) / ecb;
  const triggered =
    Math.abs(yahoo - ecb) >
    ecb * PORTFOLIO_RULE_THRESHOLDS["fx-source-divergence"].relativeDifference + 1e-12;
  return makeRule("fx-source-divergence", context, {
    status: triggered ? "warning" : "positive",
    condition: "同日 Yahoo 与欧洲央行汇率的相对差异超过 1%",
    actual: { date: verification.date ?? null, yahoo, ecb, relativeDifference },
    items: [verification],
    baseline: { relativeDifference: 0 },
    limitations: ["参考源分歧不切换核算源，也不单独阻断核算"],
  });
}

function provisionalEntries(analysis) {
  return list(analysis?.series).filter((checkpoint) => checkpoint?.provisional === true);
}

function evaluateProvisional(analysis, context) {
  if (!Array.isArray(analysis?.series)) {
    return unavailableRule("provisional-checkpoints", context, "series-unavailable");
  }
  const checkpoints = provisionalEntries(analysis);
  return makeRule("provisional-checkpoints", context, {
    status: checkpoints.length ? "warning" : "positive",
    condition: "收益序列尾部仍有等待后续数据确认的日期",
    actual: { count: checkpoints.length, dates: checkpoints.map((entry) => entry.date) },
    data: dataFrom(checkpoints, context, {
      source: "portfolio-value-series",
      provisional: checkpoints.length > 0,
    }),
    baseline: { count: 0 },
    limitations: ["暂定检查点等待后续同步确认；不会以 0 替代"],
  });
}

function evaluateConcentration(analysis, context) {
  const hhi = analysis?.summary?.hhi;
  const missing = metricUnavailable(hhi);
  if (missing) {
    const blocks = rawDependencyBlocks(context);
    return unavailableRule(
      "concentration-band",
      context,
      [...blocks.map((block) => block.reason), missing.reason],
      {
        details: missing.details,
        items: blocks,
        data: dataFrom(context?.raw?.items, context),
      },
    );
  }
  const normalized = Number(hhi.normalized);
  const raw = Number(hhi.raw);
  const count = Number(hhi.count);
  if (!Number.isFinite(normalized) || !Number.isFinite(raw) || !Number.isInteger(count)) {
    return unavailableRule("concentration-band", context, "invalid-hhi");
  }
  const threshold = PORTFOLIO_RULE_THRESHOLDS["concentration-band"];
  const band =
    normalized >= threshold.higherFrom
      ? "higher"
      : normalized >= threshold.middleFrom
        ? "middle"
        : "lower";
  return makeRule("concentration-band", context, {
    status: "neutral",
    condition:
      "集中度从 0（完全等权）到 1（集中于单一标的）连续展示；0.25 和 0.50 仅作区间参考",
    actual: { normalized, raw, count, band },
    items: analysis?.summary?.exposure?.byInstrument,
    baseline: { formula: "(H - 1/n) / (1 - 1/n)", equalWeights: 0, singlePosition: 1 },
    limitations: [
      "权重不含现金；按标的而非发行人聚合",
      "0.25 和 0.50 是产品内的描述区间，并非行业标准，也不代表好坏",
    ],
  });
}

function sortedExposure(items, identityField) {
  return list(items)
    .filter((item) => Number.isFinite(Number(item?.weight)) && Number(item.weight) > 0)
    .map((item) => ({ ...item, weight: Number(item.weight) }))
    .sort(
      (left, right) =>
        right.weight - left.weight || text(left?.[identityField]).localeCompare(text(right?.[identityField])),
    );
}

function evaluateWeightExtremes(analysis, context) {
  const exposure = analysis?.summary?.exposure;
  if (plainObject(exposure?.unavailable)) {
    const blocks = rawDependencyBlocks(context);
    return unavailableRule(
      "position-weight-extremes",
      context,
      [
        ...blocks.map((block) => block.reason),
        unavailableReason(exposure.unavailable, "exposure-unavailable"),
      ],
      { details: exposure.unavailable.details, items: blocks },
    );
  }
  if (!plainObject(exposure)) {
    return unavailableRule("position-weight-extremes", context, "insufficient-exposure-data");
  }
  const positions = sortedExposure(exposure.byInstrument, "symbol");
  const accounts = sortedExposure(exposure.byAccount, "accountId");
  if (positions.length === 0 || accounts.length === 0) {
    return unavailableRule("position-weight-extremes", context, "insufficient-exposure-data");
  }
  return makeRule("position-weight-extremes", context, {
    status: "neutral",
    condition: "展示持仓和账户的最高、最低证券权重，不预设目标仓位",
    actual: {
      maxPosition: positions[0],
      minPosition: positions.at(-1),
      maxAccount: accounts[0],
      minAccount: accounts.at(-1),
    },
    items: [...positions, ...accounts],
    baseline: { targetWeight: null },
    limitations: ["现金不进入证券权重；极值为描述而非目标配置"],
  });
}

function moneyMinor(value) {
  if (typeof value !== "string") return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/u.exec(value);
  if (!match) return null;
  const amount = BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -amount : amount;
}

function moneyString(minor) {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const integer = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${integer}.${fraction}`;
}

function evaluatePnlContributors(analysis, context) {
  const positions = statusEnvelope(context.positions);
  if (positions.status === "unavailable" || positions.status === "error") {
    return unavailableRule(
      "pnl-contributors",
      context,
      unavailableReason(positions, "pnl-data-unavailable"),
      { items: positions.items },
    );
  }
  if (positions.status !== "available" || !Array.isArray(positions.items)) {
    return unavailableRule("pnl-contributors", context, "pnl-data-unavailable");
  }
  if (positions.items.length === 0) {
    return unavailableRule("pnl-contributors", context, "no-positions", {
      data: dataFrom([], context),
    });
  }
  const blocked = positions.items.filter(
    (item) => item?.pnlBase == null || moneyMinor(item.pnlBase) == null,
  );
  if (blocked.length) {
    return unavailableRule(
      "pnl-contributors",
      context,
      blocked.map((item) => unavailableReason(item?.unavailableReason, "invalid-pnl-data")),
      {
        items: blocked,
        details: {
          blocked: blocked
            .map((item) => ({
              symbol: text(item?.symbol, text(item?.instrumentId)),
              account: text(item?.account, text(item?.accountId)),
              reason: unavailableReason(item?.unavailableReason, "invalid-pnl-data"),
            }))
            .sort(
              (left, right) =>
                left.symbol.localeCompare(right.symbol) || left.account.localeCompare(right.account),
            ),
        },
        data: dataFrom(blocked, context),
      },
    );
  }
  const grouped = new Map();
  for (const position of positions.items) {
    const symbol = text(position.symbol, text(position.instrumentId));
    const account = text(position.account, text(position.accountId));
    const current = grouped.get(symbol) ?? { symbol, accounts: new Set(), minor: 0n, evidence: [] };
    current.accounts.add(account);
    current.minor += moneyMinor(position.pnlBase);
    current.evidence.push(position);
    grouped.set(symbol, current);
  }
  const items = [...grouped.values()]
    .map((entry) => ({
      symbol: entry.symbol,
      account: [...entry.accounts].filter(Boolean).sort().join(", "),
      valueBase: moneyString(entry.minor),
      direction: entry.minor > 0n ? "positive" : entry.minor < 0n ? "negative" : "neutral",
      _minor: entry.minor,
      _evidence: entry.evidence,
    }))
    .sort((left, right) => {
      const leftAbsolute = left._minor < 0n ? -left._minor : left._minor;
      const rightAbsolute = right._minor < 0n ? -right._minor : right._minor;
      if (leftAbsolute !== rightAbsolute) return leftAbsolute > rightAbsolute ? -1 : 1;
      return left.symbol.localeCompare(right.symbol) || left.account.localeCompare(right.account);
    });
  const totals = { positive: 0n, negative: 0n, neutral: 0n };
  for (const item of items) totals[item.direction] += item._minor;
  const publicItems = items.map(({ _minor: _discardMinor, _evidence: _discardEvidence, ...item }) => item);
  return makeRule("pnl-contributors", context, {
    status: "neutral",
    condition: "全部标的按盈亏影响的绝对金额排序，最大盈利和最大亏损都会优先展示",
    actual: {
      items: publicItems,
      totals: Object.fromEntries(
        Object.entries(totals).map(([direction, amount]) => [direction, moneyString(amount)]),
      ),
    },
    items: positions.items,
    baseline: { ordering: "absolute-contribution-desc" },
    limitations: ["金额来自组合引擎；方向不产生动作建议"],
  });
}

// Collects every reason that blocks the XIRR - annualized TWR comparison. The
// engine's `short-period` is normalized to the rule vocabulary
// `insufficient-history` but kept as `upstreamCode`.
function returnUnavailable(analysis) {
  const twr = analysis?.summary?.twr;
  const reasons = [];
  let details;
  let upstreamCode;
  const twrMissing = metricUnavailable(twr);
  if (twrMissing) {
    reasons.push(twrMissing.reason);
    details ??= twrMissing.details;
  }
  const xirrMissing = metricUnavailable(analysis?.summary?.xirr);
  if (xirrMissing) {
    reasons.push(xirrMissing.reason);
    details ??= xirrMissing.details;
  }
  if (provisionalEntries(analysis).length) reasons.push("provisional");
  const annualized = twr?.annualized;
  const annualMissing = twrMissing ? null : metricUnavailable(annualized);
  if (annualMissing) {
    if (annualMissing.reason === "short-period") {
      reasons.push("insufficient-history");
      upstreamCode = "short-period";
      details ??= annualized.unavailable;
    } else {
      reasons.push(annualMissing.reason);
      details ??= annualMissing.details;
    }
  }
  return reasons.length ? { reasons, details, upstreamCode } : null;
}

function evaluateReturnGap(analysis, context) {
  const missing = returnUnavailable(analysis);
  if (missing) {
    return unavailableRule("return-method-gap", context, missing.reasons, {
      details: missing.details,
      upstreamCode: missing.upstreamCode,
      data: dataFrom([], context, {
        source: "portfolio-value-series",
        provisional: missing.reasons.includes("provisional"),
      }),
    });
  }
  const xirr = Number(analysis.summary.xirr.value);
  const annualizedTwr = Number(analysis.summary.twr.annualized.value);
  if (!Number.isFinite(xirr) || !Number.isFinite(annualizedTwr)) {
    return unavailableRule("return-method-gap", context, "invalid-return-metric");
  }
  return makeRule("return-method-gap", context, {
    status: "neutral",
    condition: "资金加权收益率减去年化时间加权收益率；只比较至少一年的数据",
    actual: { xirr, annualizedTwr, gap: Number((xirr - annualizedTwr).toPrecision(15)) },
    data: dataFrom([], context, { source: "portfolio-value-series" }),
    baseline: { gap: 0 },
    limitations: ["两种收益口径的差异不等同于择时能力、超额收益或拖累"],
  });
}

function decisionCounts(decisions) {
  const source = plainObject(decisions.counts) ? decisions.counts : {};
  return Object.fromEntries(
    PORTFOLIO_RULE_THRESHOLDS["decision-outcomes"].categories.map((category) => [
      category,
      Number.isInteger(source[category]) && source[category] >= 0 ? source[category] : 0,
    ]),
  );
}

function decisionUnavailable(context) {
  const decisions = statusEnvelope(context.decisions);
  if (decisions.status === "unavailable" || decisions.status === "error") {
    return unavailableReason(decisions, "decision-data-unavailable");
  }
  if (decisions.status !== "available" || !plainObject(decisions.counts)) {
    return "decision-data-unavailable";
  }
  return null;
}

function evaluateDecisionOutcomes(analysis, context) {
  const missing = decisionUnavailable(context);
  if (missing) {
    return unavailableRule("decision-outcomes", context, missing, {
      data: dataFrom([context.decisions], context),
    });
  }
  const counts = decisionCounts(context.decisions);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const ratios = Object.fromEntries(
    Object.entries(counts).map(([category, count]) => [category, total === 0 ? null : count / total]),
  );
  return makeRule("decision-outcomes", context, {
    status: "neutral",
    condition: "完整并列展示已兑现、部分兑现、未兑现、无法判断、未到期和待复盘",
    actual: { counts, ratios, total },
    items: [context.decisions],
    baseline: { interpretation: "user-recorded-outcome" },
    limitations: ["用户自评不是模型准确率；各类别同等结构展示"],
  });
}

function evaluateReviewDue(analysis, context) {
  const missing = decisionUnavailable(context);
  if (missing) {
    return unavailableRule("review-due", context, missing, {
      data: dataFrom([context.decisions], context),
    });
  }
  const count = decisionCounts(context.decisions).reviewDue;
  return makeRule("review-due", context, {
    status: count > 0 ? "warning" : "positive",
    condition: "复盘日期已到、但还没有填写结果的决策",
    actual: { count },
    items: [context.decisions],
    baseline: { count: 0 },
    limitations: ["只关联到期记录，不评价决策正确性"],
  });
}

function evaluateAlerts(analysis, context) {
  const alerts = statusEnvelope(context.alerts);
  if (alerts.status === "unavailable" || alerts.status === "error") {
    return unavailableRule(
      "alerts-triggered",
      context,
      unavailableReason(alerts, "alert-data-unavailable"),
      { items: alerts.items, data: dataFrom([alerts], context) },
    );
  }
  if (alerts.status !== "available" || !Array.isArray(alerts.items)) {
    return unavailableRule("alerts-triggered", context, "alert-data-unavailable");
  }
  const triggered = alerts.items
    .filter((item) => item?.triggered === true)
    .slice()
    .sort(
      (left, right) =>
        text(left?.symbol).localeCompare(text(right?.symbol)) ||
        text(left?.account, text(left?.accountId)).localeCompare(
          text(right?.account, text(right?.accountId)),
        ) ||
        text(left?.id).localeCompare(text(right?.id)),
    );
  return makeRule("alerts-triggered", context, {
    status: triggered.length ? "warning" : "positive",
    condition: "最近一次检查中已满足提醒条件的关注项",
    actual: { count: triggered.length, items: triggered },
    items: triggered.length ? triggered : [alerts],
    baseline: { count: 0 },
    limitations: ["关注触发可历史复算，但单条提醒不是完整策略回测"],
  });
}

const EVALUATORS = [
  evaluateStaleQuotes,
  evaluateFingerprint,
  evaluateRawCompleteness,
  evaluateCorporateAction,
  evaluateFxDivergence,
  evaluateProvisional,
  evaluateConcentration,
  evaluateWeightExtremes,
  evaluatePnlContributors,
  evaluateReturnGap,
  evaluateDecisionOutcomes,
  evaluateReviewDue,
  evaluateAlerts,
];

export function evaluatePortfolioRules(analysis, context = {}) {
  const safeAnalysis = plainObject(analysis) ? analysis : {};
  const safeContext = plainObject(context) ? context : {};
  const results = EVALUATORS.map((evaluate) => {
    try {
      return evaluate(safeAnalysis, safeContext);
    } catch (error) {
      const id = EVALUATORS.indexOf(evaluate);
      const ruleId = Object.keys(RULE_SPECS)[id];
      return unavailableRule(ruleId, safeContext, "invalid-rule-input", {
        details: { message: error instanceof Error ? error.message : "rule input is invalid" },
      });
    }
  });
  return results.sort(
    (left, right) =>
      left.priorityRank - right.priorityRank ||
      left.severityRank - right.severityRank ||
      left.sortSymbol.localeCompare(right.sortSymbol) ||
      left.sortAccount.localeCompare(right.sortAccount) ||
      left.id.localeCompare(right.id),
  );
}
