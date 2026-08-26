/*
 * Today's page is an evidence selector, not another analytics engine. Every
 * input here has already been evaluated by portfolio/watch code; this module
 * only chooses one navigation action and builds three compact summaries.
 */

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const MINUTES_PER_DAY = 24 * 60;

function plainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function beijingParts(instant) {
  const shifted = new Date(instant.getTime() + BEIJING_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function dateFromParts(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function addCalendarDays(parts, days) {
  const value = dateFromParts(parts);
  value.setUTCDate(value.getUTCDate() + days);
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
    weekday: value.getUTCDay(),
  };
}

function previousWeekday(parts) {
  let candidate = addCalendarDays(parts, -1);
  while (candidate.weekday === 0 || candidate.weekday === 6) {
    candidate = addCalendarDays(candidate, -1);
  }
  return candidate;
}

function isoDate(parts) {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function nextWeekday(parts, { includeToday = true } = {}) {
  let candidate = addCalendarDays(parts, includeToday ? 0 : 1);
  while (candidate.weekday === 0 || candidate.weekday === 6) {
    candidate = addCalendarDays(candidate, 1);
  }
  return candidate;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function windowText(parts, hour, minute) {
  return `北京时间 ${pad(parts.month)}-${pad(parts.day)} ${pad(hour)}:${pad(minute)}`;
}

function cnMarketStatus(parts) {
  const weekday = parts.weekday >= 1 && parts.weekday <= 5;
  const open = weekday && parts.minute >= 9 * 60 + 30 && parts.minute < 15 * 60;
  if (open) {
    return {
      market: "cn",
      label: "A 股",
      state: "open",
      stateLabel: "开放",
      nextWindow: windowText(parts, 15, 0),
    };
  }
  const candidate = nextWeekday(parts, {
    includeToday: weekday && parts.minute < 9 * 60 + 30,
  });
  return {
    market: "cn",
    label: "A 股",
    state: "closed",
    stateLabel: "闭市",
    nextWindow: windowText(candidate, 9, 30),
  };
}

function usMarketStatus(parts) {
  const eveningStart =
    parts.weekday >= 1 && parts.weekday <= 5 && parts.minute >= 21 * 60 + 30;
  const afterMidnight =
    parts.weekday >= 2 && parts.weekday <= 6 && parts.minute < 4 * 60;
  if (eveningStart || afterMidnight) {
    const closeDate = eveningStart ? addCalendarDays(parts, 1) : parts;
    return {
      market: "us",
      label: "美股",
      state: "open",
      stateLabel: "开放",
      nextWindow: windowText(closeDate, 4, 0),
    };
  }

  const isStartWeekday = parts.weekday >= 1 && parts.weekday <= 5;
  const candidate = nextWeekday(parts, {
    includeToday: isStartWeekday && parts.minute < 21 * 60 + 30,
  });
  return {
    market: "us",
    label: "美股",
    state: "closed",
    stateLabel: "闭市",
    nextWindow: windowText(candidate, 21, 30),
  };
}

function toInstant(value, label) {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error(`${label} requires a valid instant`);
  return instant;
}

export function marketStatusAt(instant = new Date()) {
  const value = toInstant(instant, "market clock");
  const parts = beijingParts(value);
  return {
    timezone: "Asia/Shanghai",
    basis: "固定北京时间常规窗口；未校验交易所节假日",
    cn: cnMarketStatus(parts),
    us: usMarketStatus(parts),
  };
}

function priorityRank(value) {
  const match = /^P([0-3])$/u.exec(typeof value === "string" ? value : "");
  return match ? Number(match[1]) : 99;
}

function stableRules(rules) {
  return [...list(rules)].sort(
    (left, right) =>
      priorityRank(left?.priority) - priorityRank(right?.priority) ||
      String(left?.id ?? "").localeCompare(String(right?.id ?? "")),
  );
}

function stableWatch(results) {
  return [...list(results)].sort((left, right) => {
    const id = String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
    if (id) return id;
    return String(left?.symbol ?? "").localeCompare(String(right?.symbol ?? ""));
  });
}

function evidence(fields) {
  return {
    id: fields.id,
    actual: fields.actual ?? null,
    threshold: fields.threshold ?? null,
    source: fields.source ?? "unavailable",
    availableAt: fields.availableAt ?? null,
    stale: fields.stale === true,
    provisional: fields.provisional === true,
  };
}

function ruleEvidence(rule) {
  return evidence({
    id: rule.id,
    actual: Object.hasOwn(rule, "actual") ? rule.actual : null,
    threshold: Object.hasOwn(rule, "threshold") ? rule.threshold : null,
    source: rule.data?.source,
    availableAt: rule.data?.availableAt,
    stale: rule.data?.stale,
    provisional: rule.data?.provisional,
  });
}

// A persisted watch result is only fresh evidence while its bar is no older
// than the last regular weekday before today (fixed Beijing calendar, no
// holiday calendar, so a holiday gap reads as stale rather than as current).
// Unknown bar dates are never fresh: a trigger without a time is not evidence.
function watchBarDate(result) {
  for (const field of ["asOf", "availableAt", "checkedAt"]) {
    const value = result?.[field];
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/u.test(value)) return value.slice(0, 10);
  }
  return null;
}

function isFreshWatch(result, nowParts) {
  if (result?.stale === true) return false;
  const barDate = watchBarDate(result);
  if (!barDate) return false;
  return barDate >= isoDate(previousWeekday(nowParts));
}

function isLiveTrigger(result, nowParts) {
  return result?.triggered === true && !result?.error && isFreshWatch(result, nowParts);
}

function watchEvidence(result, nowParts) {
  const actual = Object.hasOwn(result, "actual")
    ? result.actual
    : {
        symbol: result.symbol ?? null,
        rule: result.rule ?? null,
        close: Number.isFinite(result.close) ? result.close : null,
        changePct: Number.isFinite(result.changePct) ? result.changePct : null,
        distance: Number.isFinite(result.distance) ? result.distance : null,
        triggered: result.triggered === true,
      };
  return evidence({
    id: result.id ?? `${result.symbol ?? "watch"}:${result.rule ?? "rule"}`,
    actual,
    threshold: Object.hasOwn(result, "threshold") ? result.threshold : null,
    source: result.source,
    availableAt: result.availableAt ?? result.checkedAt ?? result.asOf,
    stale: result.stale === true || !isFreshWatch(result, nowParts),
    provisional: result.provisional,
  });
}

function isP0(rule, statuses) {
  return rule?.priority === "P0" && statuses.includes(rule?.status);
}

function action(id, label, module, focus, selectedEvidence) {
  return { id, label, module, focus, evidence: selectedEvidence };
}

function chooseAction(portfolio, watchResults, dataStatus, nowParts) {
  if (portfolio.ledgerExists !== true) {
    return action(
      "add-holding",
      "添加持仓",
      "holdings",
      "portfolio-entry",
      evidence({
        id: "portfolio-ledger",
        actual: { ledgerExists: false },
        threshold: { ledgerExists: true },
        source: "portfolio/transactions.json",
      }),
    );
  }

  // Priority (PRD §6.1, Round 13): a P0 *warning* is verified bad/inconsistent
  // portfolio data and always wins. A fresh, real watch hit comes next: it
  // carries its own CSV evidence, so a P0 *unavailable* (a dependency that
  // could not be checked, e.g. the quote feed is not integrated) must not bury
  // it. Without a fresh hit the P0 unavailable still leads.
  const rules = stableRules(portfolio.rules);
  const p0Warning = rules.find((rule) => isP0(rule, ["warning"]));
  if (p0Warning) {
    return action("sync-data", "同步数据", "holdings", "portfolio-analysis", ruleEvidence(p0Warning));
  }

  const evaluated = stableWatch(watchResults);
  const hit = evaluated.find((result) => isLiveTrigger(result, nowParts));
  if (hit) {
    return action("view-trigger", "查看触发", "watch", "watch-trigger", watchEvidence(hit, nowParts));
  }

  const p0Unavailable = rules.find((rule) => isP0(rule, ["unavailable"]));
  if (p0Unavailable) {
    return action(
      "sync-data",
      "同步数据",
      "holdings",
      "portfolio-analysis",
      ruleEvidence(p0Unavailable),
    );
  }

  const important = rules.find(
    (rule) => rule?.priority !== "P0" && rule?.status === "warning",
  );
  if (important) {
    return action(
      "view-holdings-analysis",
      "查看持仓分析",
      "holdings",
      "portfolio-analysis",
      ruleEvidence(important),
    );
  }

  if (evaluated.length > 0) {
    return action(
      "view-watch",
      "查看关注",
      "watch",
      "watch-heading",
      watchEvidence(evaluated[0], nowParts),
    );
  }

  return action(
    "view-research",
    "查看研究",
    "research",
    "research-heading",
    evidence({
      id: "research-data",
      actual: plainObject(dataStatus) ? (dataStatus.status ?? "available") : "unavailable",
      threshold: { status: "available" },
      source: dataStatus?.source,
      availableAt: dataStatus?.availableAt,
      stale: dataStatus?.stale,
      provisional: dataStatus?.provisional,
    }),
  );
}

export function buildTodayModel(input) {
  const nowInstant = toInstant(input?.now ?? new Date(), "today model now");
  const nowParts = beijingParts(nowInstant);
  const portfolio = plainObject(input?.portfolio) ? input.portfolio : {};
  const watchResults = stableWatch(input?.watchResults);
  const triggered = watchResults.filter((item) => item?.triggered === true && !item?.error);
  const staleTriggered = triggered.filter((item) => !isFreshWatch(item, nowParts));
  const dataStatus = plainObject(input?.dataStatus) ? input.dataStatus : {};
  const p0Blockers = list(portfolio.rules).filter((rule) => isP0(rule, ["warning", "unavailable"]));
  const portfolioSummary = {
    ledgerExists: portfolio.ledgerExists === true,
    hasPositions: portfolio.hasPositions === true,
    summary: portfolio.summary ?? null,
    analysis: portfolio.analysis ?? null,
  };
  const latestWatch = [...watchResults].sort((left, right) =>
    String(right?.availableAt ?? right?.checkedAt ?? "").localeCompare(
      String(left?.availableAt ?? left?.checkedAt ?? ""),
    ),
  )[0];
  const summaries = [
    {
      id: "portfolio",
      label: "持仓",
      state: portfolio.ledgerExists === true ? "available" : "unavailable",
      value: portfolio.summary?.totalBase ?? null,
      reason: portfolio.ledgerExists === true ? null : "ledger-not-found",
      evidence: evidence({
        id: "portfolio-summary",
        actual: portfolio.summary?.totalBase ?? null,
        threshold: null,
        source: portfolio.summary?.source ?? "portfolio-analysis",
        availableAt: portfolio.summary?.availableAt,
        stale: portfolio.summary?.stale,
        provisional: portfolio.summary?.provisional,
      }),
    },
    {
      id: "watch",
      label: "关注",
      state: watchResults.length > 0 ? "checked" : "unavailable",
      value:
        watchResults.length > 0
          ? `${triggered.length} 触发 · ${watchResults.length} 已检查${staleTriggered.length ? ` · ${staleTriggered.length} 条过期` : ""}`
          : null,
      reason: watchResults.length > 0 ? null : "no-persisted-watch-evaluation",
      evidence: latestWatch
        ? watchEvidence(latestWatch, nowParts)
        : evidence({ id: "watch-evaluation", source: "panel-storage/watchlist" }),
    },
    {
      id: "data",
      label: "最近变化",
      state: p0Blockers.length > 0 ? "attention" : (dataStatus.status ?? "available"),
      value:
        dataStatus.message ??
        (p0Blockers.length > 0 ? `${p0Blockers.length} 条 P0 数据状态待查看` : null),
      reason: dataStatus.reason ?? null,
      evidence: evidence({
        id: dataStatus.id ?? "data-status",
        actual: dataStatus.status ?? null,
        threshold: dataStatus.threshold ?? null,
        source: dataStatus.source,
        availableAt: dataStatus.availableAt,
        stale: dataStatus.stale,
        provisional: dataStatus.provisional,
      }),
    },
  ];

  return {
    marketStatus: input?.marketStatus ?? marketStatusAt(nowInstant),
    primaryAction: chooseAction(portfolio, watchResults, dataStatus, nowParts),
    portfolioSummary,
    watchResults,
    summaries,
    newsSummary: input?.newsSummary ?? { status: "unavailable", reason: "not-implemented" },
    reviewDue: input?.reviewDue ?? { status: "unavailable", reason: "not-implemented" },
  };
}
