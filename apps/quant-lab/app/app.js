/* Quant Lab Panel App runtime. */
/* global document, localStorage, window */

import {
  analyzeDataset,
  evaluateWatchItem,
  fencedMarkdown,
  fingerprintBars,
  fingerprintText,
  generateDemoBars,
  isSafeCsvPath,
  markdownInlineCode,
  markdownPlainText,
  parameterSweep,
  parseOhlcvCsv,
  researchEvidence,
  rankWatchResults,
  runBacktest,
  walkForward,
} from "./engine.mjs";
import { buildTodayModel, marketStatusAt } from "./today-model.mjs";
import { createAlertsController } from "./modules/alerts-ui.mjs";
import { createHoldingsController } from "./modules/holdings-ui.mjs";
import { createNewsController } from "./modules/news-ui.mjs";
import { createNotesController } from "./modules/notes-ui.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";
const elements = {
  dataPath: document.querySelector("#data-path"),
  loadData: document.querySelector("#load-data"),
  askAgent: document.querySelector("#ask-agent"),
  agentDialog: document.querySelector("#agent-dialog"),
  agentRequest: document.querySelector("#agent-request"),
  agentState: document.querySelector("#agent-state"),
  submitAgent: document.querySelector("#submit-agent"),
  instrumentName: document.querySelector("#instrument-name"),
  datasetBadge: document.querySelector("#dataset-badge"),
  datasetMeta: document.querySelector("#dataset-meta"),
  dataQuality: document.querySelector("#data-quality"),
  runState: document.querySelector("#run-state"),
  runBacktest: document.querySelector("#run-backtest"),
  saveStrategy: document.querySelector("#save-strategy"),
  saveReport: document.querySelector("#save-report"),
  strategyType: document.querySelector("#strategy-type"),
  smaParams: document.querySelector("#sma-params"),
  rsiParams: document.querySelector("#rsi-params"),
  breakoutParams: document.querySelector("#breakout-params"),
  fastPeriod: document.querySelector("#fast-period"),
  slowPeriod: document.querySelector("#slow-period"),
  rsiPeriod: document.querySelector("#rsi-period"),
  rsiOversold: document.querySelector("#rsi-oversold"),
  rsiOverbought: document.querySelector("#rsi-overbought"),
  breakoutPeriod: document.querySelector("#breakout-period"),
  initialCapital: document.querySelector("#initial-capital"),
  feeBps: document.querySelector("#fee-bps"),
  slippageBps: document.querySelector("#slippage-bps"),
  stopLoss: document.querySelector("#stop-loss"),
  metricReturn: document.querySelector("#metric-return"),
  metricFinalEquity: document.querySelector("#metric-final-equity"),
  metricCagr: document.querySelector("#metric-cagr"),
  metricCagrDetail: document.querySelector("#metric-cagr-detail"),
  metricDrawdown: document.querySelector("#metric-drawdown"),
  metricDrawdownDetail: document.querySelector("#metric-drawdown-detail"),
  metricSharpe: document.querySelector("#metric-sharpe"),
  metricSharpeDetail: document.querySelector("#metric-sharpe-detail"),
  metricWinRate: document.querySelector("#metric-win-rate"),
  metricTrades: document.querySelector("#metric-trades"),
  metricExposure: document.querySelector("#metric-exposure"),
  chartTitle: document.querySelector("#chart-title"),
  chart: document.querySelector("#chart"),
  chartWrap: document.querySelector("#chart-wrap"),
  chartGrid: document.querySelector("#chart-grid"),
  chartSeries: document.querySelector("#chart-series"),
  chartLabels: document.querySelector("#chart-labels"),
  chartCursor: document.querySelector("#chart-cursor"),
  chartTooltip: document.querySelector("#chart-tooltip"),
  chartLegend: document.querySelector("#chart-legend"),
  tradesBody: document.querySelector("#trades-body"),
  tradeSummary: document.querySelector("#trade-summary"),
  toast: document.querySelector("#toast"),
  signalMode: document.querySelector("#signal-mode"),
  sizerType: document.querySelector("#sizer-type"),
  sizerFractionParams: document.querySelector("#sizer-fraction-params"),
  sizerVolatilityParams: document.querySelector("#sizer-volatility-params"),
  sizerPct: document.querySelector("#sizer-pct"),
  sizerAnnual: document.querySelector("#sizer-annual"),
  sizerLookback: document.querySelector("#sizer-lookback"),
  riskFreeRate: document.querySelector("#risk-free-rate"),
  wfInSample: document.querySelector("#wf-in-sample"),
  wfOutSample: document.querySelector("#wf-out-sample"),
  runValidation: document.querySelector("#run-validation"),
  validationCard: document.querySelector("#validation-card"),
  validationSummary: document.querySelector("#validation-summary"),
  validationBody: document.querySelector("#validation-body"),
  verdict: document.querySelector("#verdict"),
  verdictBadge: document.querySelector("#verdict-badge"),
  verdictLine: document.querySelector("#verdict-line"),
  verdictReasons: document.querySelector("#verdict-reasons"),
  verdictAction: document.querySelector("#verdict-action"),
  watchSymbol: document.querySelector("#watch-symbol"),
  watchRule: document.querySelector("#watch-rule"),
  watchThreshold: document.querySelector("#watch-threshold"),
  watchAdd: document.querySelector("#watch-add"),
  watchlistItems: document.querySelector("#watchlist-items"),
  watchlistSummary: document.querySelector("#watchlist-summary"),
  watchCheck: document.querySelector("#watch-check"),
  watchSchedule: document.querySelector("#watch-schedule"),
  watchScheduleState: document.querySelector("#watch-schedule-state"),
  watchMigrationState: document.querySelector("#watch-migration-state"),
  todayPrimaryTitle: document.querySelector("#today-primary-title"),
  todayPrimaryDetail: document.querySelector("#today-primary-detail"),
  todayPrimaryEvidence: document.querySelector("#today-primary-evidence"),
  todayPrimaryAction: document.querySelector("#today-primary-action"),
  todayMarketCn: document.querySelector("#today-market-cn"),
  todayMarketUs: document.querySelector("#today-market-us"),
  todayMarketBasis: document.querySelector("#today-market-basis"),
  todaySummaryList: document.querySelector("#today-summary-list"),
  portfolioStatus: document.querySelector("#portfolio-status"),
  portfolioEmpty: document.querySelector("#portfolio-empty"),
  portfolioWorkspace: document.querySelector("#portfolio-workspace"),
  portfolioCreate: document.querySelector("#portfolio-create"),
  portfolioTotalBase: document.querySelector("#portfolio-total-base"),
  portfolioLocalState: document.querySelector("#portfolio-local-state"),
  portfolioBaseState: document.querySelector("#portfolio-base-state"),
  portfolioSummaryNote: document.querySelector("#portfolio-summary-note"),
  portfolioFxSource: document.querySelector("#portfolio-fx-source"),
  portfolioAnalysisStatus: document.querySelector("#portfolio-analysis-status"),
  portfolioAnalysisList: document.querySelector("#portfolio-analysis-list"),
  portfolioAnalysisAgent: document.querySelector("#portfolio-analysis-agent"),
  portfolioAnalysisAgentState: document.querySelector("#portfolio-analysis-agent-state"),
  portfolioRefresh: document.querySelector("#portfolio-refresh"),
  portfolioHoldingsList: document.querySelector("#portfolio-holdings-list"),
  portfolioForm: document.querySelector("#portfolio-transaction-form"),
  portfolioAccount: document.querySelector("#portfolio-account"),
  portfolioMarket: document.querySelector("#portfolio-market"),
  portfolioSymbol: document.querySelector("#portfolio-symbol"),
  portfolioName: document.querySelector("#portfolio-name"),
  portfolioSide: document.querySelector("#portfolio-side"),
  portfolioDate: document.querySelector("#portfolio-date"),
  portfolioQuantity: document.querySelector("#portfolio-quantity"),
  portfolioPrice: document.querySelector("#portfolio-price"),
  portfolioCurrency: document.querySelector("#portfolio-currency"),
  portfolioCommission: document.querySelector("#portfolio-commission"),
  portfolioTax: document.querySelector("#portfolio-tax"),
  portfolioOtherFees: document.querySelector("#portfolio-other-fees"),
  portfolioFormError: document.querySelector("#portfolio-form-error"),
  portfolioSave: document.querySelector("#portfolio-save"),
  portfolioTransactionCount: document.querySelector("#portfolio-transaction-count"),
  portfolioTransactionsList: document.querySelector("#portfolio-transactions-list"),
  watchAutomationCn: document.querySelector("#watch-automation-cn"),
  watchAutomationCnTime: document.querySelector("#watch-automation-cn-time"),
  watchAutomationCnStatus: document.querySelector("#watch-automation-cn-status"),
  watchAutomationCnAction: document.querySelector("#watch-automation-cn-action"),
  watchAutomationUs: document.querySelector("#watch-automation-us"),
  watchAutomationUsTime: document.querySelector("#watch-automation-us-time"),
  watchAutomationUsStatus: document.querySelector("#watch-automation-us-status"),
  watchAutomationUsAction: document.querySelector("#watch-automation-us-action"),
  watchLegacyAutomation: document.querySelector("#watch-legacy-automation"),
  watchLegacyState: document.querySelector("#watch-legacy-state"),
  watchLegacyRemove: document.querySelector("#watch-legacy-remove"),
  newsRoot: document.querySelector("#module-news"),
  notesRoot: document.querySelector("#module-notes"),
};

const MODULE_IDS = ["today", "holdings", "watch", "research", "news", "notes"];
const moduleTabs = [...document.querySelectorAll("[data-module-tab]")];
const modulePanels = new Map(
  [...document.querySelectorAll("[data-module]")].map((panel) => [panel.dataset.module, panel]),
);

let bars = generateDemoBars();
let lastValidation = null;
let dataset = {
  kind: "demo",
  path: null,
  name: "DEMO / SYNTHETIC",
  source: "synthetic sample",
};
let result = null;
let chartMode = "equity";
let context = { busy: false, trusted: false };
let toastTimer;
let workspaceEpoch = 0;
let contextInitialized = false;
let activeModule = "today";
let configurationStorageValue = {};
let hasPortfolioPositions = false;
let holdingsController = null;
let alertsController = null;
let newsController = null;
let notesController = null;
let notesDecisionFacts = {
  status: "unavailable",
  reason: "notes-not-loaded",
  source: "portfolio/journal.json",
};
let todayViewModel = null;
let portfolioTodayState = {
  ledgerExists: false,
  hasPositions: false,
  summary: null,
  analysis: null,
  rules: [],
  dataStatus: {
    status: "unavailable",
    reason: "ledger-not-loaded",
    source: "portfolio/transactions.json",
    availableAt: null,
    stale: false,
    provisional: false,
  },
};

function currentInstant() {
  const override = window.__quantLabNow;
  const value = override ? new Date(override) : new Date();
  return Number.isNaN(value.getTime()) ? new Date() : value;
}

function scopedStorageKey(base, workspaceRoot = context.cwd ?? "preview") {
  let primary = 2_166_136_261;
  let secondary = 2_654_435_769;
  for (let index = 0; index < workspaceRoot.length; index += 1) {
    const code = workspaceRoot.charCodeAt(index);
    primary = Math.imul(primary ^ code, 16_777_619);
    secondary = Math.imul(secondary ^ code, 2_246_822_519);
    secondary ^= secondary >>> 13;
  }
  const scope = [primary, secondary]
    .map((value) => (value >>> 0).toString(16).padStart(8, "0"))
    .join("");
  return `${base}.${scope}`;
}

function activeModuleStorageKey(workspaceRoot = context.cwd ?? "preview") {
  return scopedStorageKey("activeTab", workspaceRoot);
}

function activateModule(moduleId, { focusTarget = "tab", persist = true } = {}) {
  const nextModule = MODULE_IDS.includes(moduleId) ? moduleId : "today";
  activeModule = nextModule;
  for (const tab of moduleTabs) {
    const selected = tab.dataset.moduleTab === nextModule;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  for (const [candidate, panel] of modulePanels) {
    panel.hidden = candidate !== nextModule;
  }
  const selectedTab = moduleTabs.find((tab) => tab.dataset.moduleTab === nextModule);
  const selectedPanel = modulePanels.get(nextModule);
  if (focusTarget === "heading") selectedPanel?.querySelector("h1")?.focus();
  else if (focusTarget === "tab") selectedTab?.focus();
  if (persist) {
    void hostCall("storage.set", {
      key: activeModuleStorageKey(),
      value: nextModule,
    }).catch(() => undefined);
  }
}

async function restoreActiveModule(storageRoot, epoch) {
  const saved = await hostCall("storage.get", {
    key: activeModuleStorageKey(storageRoot),
  }).catch(() => null);
  if (epoch !== workspaceEpoch) return;
  activateModule(MODULE_IDS.includes(saved) ? saved : "today", {
    focusTarget: "none",
    persist: false,
  });
}

function numberValue(
  element,
  label,
  { minimum, maximum, maximumInclusive = false, integer = false },
) {
  const value = Number(element.value);
  if (
    !Number.isFinite(value) ||
    value < minimum ||
    (maximumInclusive ? value > maximum : value >= maximum) ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(
      `${label}必须是${integer ? "整数，且" : ""}不小于 ${minimum}、${maximumInclusive ? "不大于" : "小于"} ${maximum}`,
    );
  }
  return value;
}

function currentStrategy() {
  if (elements.strategyType.value === "sma-cross") {
    const fast = numberValue(elements.fastPeriod, "快速均线周期", {
      minimum: 2,
      maximum: 100_000,
      integer: true,
    });
    const slow = numberValue(elements.slowPeriod, "慢速均线周期", {
      minimum: 3,
      maximum: 100_000,
      integer: true,
    });
    if (fast >= slow) throw new Error("快速均线周期必须小于慢速均线周期");
    return { type: "sma-cross", fast, slow };
  }
  if (elements.strategyType.value === "rsi-reversion") {
    const period = numberValue(elements.rsiPeriod, "RSI 周期", {
      minimum: 2,
      maximum: 100_000,
      integer: true,
    });
    const oversold = numberValue(elements.rsiOversold, "RSI 超卖阈值", {
      minimum: 0,
      maximum: 100,
      maximumInclusive: true,
    });
    const overbought = numberValue(elements.rsiOverbought, "RSI 超买阈值", {
      minimum: 0,
      maximum: 100,
      maximumInclusive: true,
    });
    if (oversold >= overbought) throw new Error("RSI 超卖阈值必须小于超买阈值");
    return { type: "rsi-reversion", period, oversold, overbought };
  }
  return {
    type: "breakout",
    lookback: numberValue(elements.breakoutPeriod, "突破周期", {
      minimum: 2,
      maximum: 100_000,
      integer: true,
    }),
  };
}

function currentConfiguration() {
  return {
    strategy: currentStrategy(),
    initialCapital: numberValue(elements.initialCapital, "初始资金", {
      minimum: 100,
      maximum: Number.MAX_VALUE,
    }),
    feeBps: numberValue(elements.feeBps, "手续费", {
      minimum: 0,
      maximum: 10_000,
    }),
    slippageBps: numberValue(elements.slippageBps, "滑点", {
      minimum: 0,
      maximum: 10_000,
    }),
    stopLossPct: numberValue(elements.stopLoss, "止损比例", {
      minimum: 0,
      maximum: 100,
    }),
    signalMode: elements.signalMode.value === "edge" ? "edge" : "state",
    sizer: currentSizer(),
    // The UI collects a percentage; the engine expects a decimal.
    riskFreeRate:
      numberValue(elements.riskFreeRate, "无风险利率", { minimum: 0, maximum: 20 }) / 100,
  };
}

function currentSizer() {
  const type = elements.sizerType.value;
  if (type === "fixed-fraction") {
    return {
      type,
      pct: numberValue(elements.sizerPct, "仓位比例", { minimum: 1, maximum: 100 }),
    };
  }
  if (type === "volatility-target") {
    return {
      type,
      annual: numberValue(elements.sizerAnnual, "年化波动目标", { minimum: 1, maximum: 200 }),
      lookback: numberValue(elements.sizerLookback, "回看窗口", { minimum: 2, maximum: 2_000 }),
    };
  }
  return { type: "all-in" };
}

function syncSizerFields() {
  const type = elements.sizerType.value;
  elements.sizerFractionParams.hidden = type !== "fixed-fraction";
  elements.sizerVolatilityParams.hidden = type !== "volatility-target";
}

function formatMoney(value, decimals = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(value);
}

function formatPercent(value, decimals = 1) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(decimals)}%`;
}

function formatPrice(value) {
  return Number(value).toFixed(2);
}

function setRunState(message, kind = "ready") {
  elements.runState.textContent = message;
  elements.runState.classList.toggle("error", kind === "error");
}

function notify(message, kind = "idle") {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", kind === "error");
  elements.toast.hidden = false;
  toastTimer = setTimeout(
    () => {
      elements.toast.hidden = true;
    },
    kind === "error" ? 5200 : 2800,
  );
}

function mockHostCall(method, params = {}) {
  const prefix = "codeshell-quant-lab:";
  if (method === "storage.get") {
    return Promise.resolve(
      JSON.parse(localStorage.getItem(`${prefix}storage:${params.key}`) || "null"),
    );
  }
  if (method === "storage.set") {
    localStorage.setItem(`${prefix}storage:${params.key}`, JSON.stringify(params.value));
    return Promise.resolve(true);
  }
  if (method === "workspace.info") {
    return Promise.resolve({
      name: "codeshell",
      root: "/preview/codeshell",
      trusted: true,
      gitBranch: "preview",
    });
  }
  if (method === "workspace.readText") {
    const content = localStorage.getItem(`${prefix}file:${params.path}`);
    if (content == null) return Promise.reject(new Error("预览环境中没有这个 CSV 文件"));
    const modifiedAt = Number(localStorage.getItem(`${prefix}mtime:${params.path}`)) || Date.now();
    return Promise.resolve({
      path: params.path,
      content,
      size: content.length,
      modifiedAt,
      revision: `preview:${modifiedAt}`,
    });
  }
  if (method === "workspace.list") {
    const path = params.path.replace(/\/$/u, "");
    const entries = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(`${prefix}file:${path}/`)) continue;
      const filePath = key.slice(`${prefix}file:`.length);
      entries.push({ kind: "file", path: filePath, name: filePath.slice(path.length + 1) });
    }
    return Promise.resolve({ path, entries, truncated: false });
  }
  if (method === "workspace.writeText") {
    const modifiedAt = Date.now();
    localStorage.setItem(`${prefix}file:${params.path}`, params.content);
    localStorage.setItem(`${prefix}mtime:${params.path}`, String(modifiedAt));
    return Promise.resolve({
      path: params.path,
      size: params.content.length,
      modifiedAt,
      revision: `preview:${modifiedAt}`,
    });
  }
  if (method === "agent.submitPrompt") return Promise.resolve({ accepted: true });
  return Promise.resolve(null);
}

function hostCall(method, params) {
  if (window.codeshellPanel?.call) return window.codeshellPanel.call(method, params);
  return mockHostCall(method, params);
}

function todayWatchResults() {
  return watchlist
    .filter((item) => item?.last && !item.last.error)
    .map((item) => ({
      ...item.last,
      id: item.id ?? `${item.symbol}:${item.rule?.type ?? "rule"}`,
      symbol: item.symbol,
      rule: item.last.rule ?? item.rule?.type ?? null,
      threshold: item.rule ?? null,
      source: item.last.source ?? watchDataPath(item.symbol),
      availableAt: item.last.availableAt ?? item.last.checkedAt ?? item.last.asOf ?? null,
      stale: item.last.stale === true,
      provisional: item.last.provisional === true,
    }));
}

function evidenceInline(value) {
  const printable = (field) => {
    const item = value?.[field];
    return item == null ? "unavailable" : typeof item === "string" ? item : JSON.stringify(item);
  };
  return [
    `id ${printable("id")}`,
    `actual ${printable("actual")}`,
    `threshold ${printable("threshold")}`,
    `source ${printable("source")}`,
    `availableAt ${printable("availableAt")}`,
    `stale ${value?.stale === true}`,
    `provisional ${value?.provisional === true}`,
  ].join(" · ");
}

function renderToday() {
  const clock = marketStatusAt(currentInstant());
  todayViewModel = buildTodayModel({
    now: currentInstant(),
    portfolio: portfolioTodayState,
    watchResults: todayWatchResults(),
    dataStatus: portfolioTodayState.dataStatus,
    marketStatus: clock,
    // M4 persists a full feed, but Round 14 deliberately does not add a Today
    // summary so it cannot displace the approved P0 / real-watch priority.
    newsSummary: { status: "unavailable", reason: "news-summary-not-connected" },
    reviewDue: { status: "unavailable", reason: "review-schema-not-implemented" },
  });
  const marketText = (market) =>
    `${market.label} · ${market.stateLabel} · ${market.state === "open" ? "本窗口至" : "下一窗口"} ${market.nextWindow}`;
  elements.todayMarketCn.textContent = marketText(clock.cn);
  elements.todayMarketCn.dataset.state = clock.cn.state;
  elements.todayMarketUs.textContent = marketText(clock.us);
  elements.todayMarketUs.dataset.state = clock.us.state;
  elements.todayMarketBasis.textContent = clock.basis;

  const selected = todayViewModel.primaryAction;
  elements.todayPrimaryTitle.textContent =
    selected.id === "add-holding"
      ? "先建立权威账本"
      : selected.id === "sync-data"
        ? "先查看数据阻断"
        : selected.id === "view-trigger"
          ? "已有关注规则触发"
          : selected.id === "view-holdings-analysis"
            ? "持仓分析有重要状态"
            : selected.id === "view-watch"
              ? "检查最近关注结果"
              : "查看研究证据";
  elements.todayPrimaryDetail.textContent =
    selected.id === "add-holding"
      ? "尚无 portfolio/transactions.json；一次跳转到真实交易表单。"
      : "主行动由已计算的规则与最近一次真实关注检查确定；今日页不重算指标。";
  elements.todayPrimaryEvidence.textContent = evidenceInline(selected.evidence);
  elements.todayPrimaryAction.textContent = selected.label;
  elements.todayPrimaryAction.dataset.moduleLink = selected.module;
  elements.todayPrimaryAction.dataset.focusTarget = selected.focus;

  elements.todaySummaryList.replaceChildren();
  for (const summary of todayViewModel.summaries.slice(0, 3)) {
    const row = document.createElement("p");
    row.className = "today-summary-item";
    const label = document.createElement("b");
    label.textContent = summary.label;
    const detail = document.createElement("span");
    detail.textContent =
      summary.value == null
        ? `unavailable · ${summary.reason ?? "no-data"}`
        : typeof summary.value === "string"
          ? summary.value
          : JSON.stringify(summary.value);
    row.append(label, detail);
    elements.todaySummaryList.append(row);
  }
}

holdingsController = createHoldingsController({
  hostCall,
  currentEpoch: () => workspaceEpoch,
  now: currentInstant,
  elements: {
    status: elements.portfolioStatus,
    empty: elements.portfolioEmpty,
    workspace: elements.portfolioWorkspace,
    create: elements.portfolioCreate,
    totalBase: elements.portfolioTotalBase,
    localState: elements.portfolioLocalState,
    baseState: elements.portfolioBaseState,
    summaryNote: elements.portfolioSummaryNote,
    fxSource: elements.portfolioFxSource,
    analysisStatus: elements.portfolioAnalysisStatus,
    analysisList: elements.portfolioAnalysisList,
    analysisAgent: elements.portfolioAnalysisAgent,
    analysisAgentState: elements.portfolioAnalysisAgentState,
    refresh: elements.portfolioRefresh,
    holdingsList: elements.portfolioHoldingsList,
    form: elements.portfolioForm,
    account: elements.portfolioAccount,
    market: elements.portfolioMarket,
    symbol: elements.portfolioSymbol,
    name: elements.portfolioName,
    side: elements.portfolioSide,
    date: elements.portfolioDate,
    quantity: elements.portfolioQuantity,
    price: elements.portfolioPrice,
    currency: elements.portfolioCurrency,
    commission: elements.portfolioCommission,
    tax: elements.portfolioTax,
    otherFees: elements.portfolioOtherFees,
    formError: elements.portfolioFormError,
    save: elements.portfolioSave,
    transactionCount: elements.portfolioTransactionCount,
    transactionsList: elements.portfolioTransactionsList,
  },
  onPortfolioState({ hasPositions }) {
    hasPortfolioPositions = hasPositions;
  },
  onViewState(viewState) {
    portfolioTodayState = viewState;
    renderToday();
  },
  ruleContext() {
    return {
      decisions: {
        status: "unavailable",
        reason: "decision-outcome-schema-not-implemented",
        source: "portfolio/journal.json",
      },
      alerts: {
        status: "available",
        items: watchlist
          .filter((item) => item.last?.triggered === true)
          .map((item) => ({
            id: item.id,
            symbol: item.symbol,
            triggered: true,
            source: "panel-storage/watchlist",
            availableAt: item.last?.checkedAt ?? null,
          })),
        source: "panel-storage/watchlist",
        availableAt: currentInstant().toISOString(),
      },
    };
  },
  onRecordNote(link) {
    openNotes(link);
  },
  noteLinkCount(link) {
    return linkedNoteCount(link);
  },
});

async function writeRepoText(path, content) {
  const operationWorkspaceEpoch = workspaceEpoch;
  let expectedModifiedAt = null;
  let expectedRevision = null;
  try {
    const existing = await hostCall("workspace.readText", { path });
    expectedModifiedAt = existing.modifiedAt;
    expectedRevision = existing.revision;
  } catch {
    // A missing output is created; unreadable existing output fails the host conflict check.
  }
  if (operationWorkspaceEpoch !== workspaceEpoch) {
    throw new Error("工作区已在操作期间切换；旧操作已取消，请在当前仓库重试");
  }
  const result = await hostCall("workspace.writeText", {
    path,
    content,
    expectedModifiedAt,
    ...(expectedRevision ? { expectedRevision } : {}),
  });
  if (operationWorkspaceEpoch !== workspaceEpoch) {
    throw new Error("工作区已在操作期间切换；旧操作已取消，请在当前仓库重试");
  }
  return result;
}

function renderDataset() {
  // Prefer the human name from the sidecar; a bare code like SH600519 tells a
  // reader far less than 贵州茅台.
  const displayName = dataset.meta?.stale === true ? null : dataset.meta?.name;
  elements.instrumentName.textContent = displayName || dataset.name;
  elements.datasetBadge.textContent = dataset.kind === "demo" ? "DEMO" : "REPO DATA";
  elements.datasetBadge.className = `badge ${dataset.kind === "demo" ? "demo" : "live"}`;
  const first = bars[0];
  const last = bars.at(-1);
  const codeLabel = displayName && displayName !== dataset.name ? `${dataset.name} · ` : "";
  elements.datasetMeta.textContent = `${codeLabel}${bars.length} daily bars · ${first.date} → ${last.date} · ${dataset.source}`;
  const quality = analyzeDataset(bars);
  elements.dataQuality.dataset.state = quality.warnings.length === 0 ? "ok" : "warning";
  elements.dataQuality.textContent =
    quality.warnings.length === 0
      ? "数据检查通过"
      : `${quality.warnings.length} 项数据提醒 · ${quality.warnings.map((warning) => warning.message).join("；")}`;
}

function renderMetrics() {
  const metrics = result.metrics;
  elements.metricReturn.textContent = formatPercent(metrics.totalReturn);
  elements.metricFinalEquity.textContent = `${formatMoney(metrics.finalEquity)} final equity`;
  elements.metricCagr.textContent = formatPercent(metrics.annualizedReturn);
  elements.metricCagrDetail.textContent = `B&H ${formatPercent(metrics.benchmarkReturn)} · excess ${formatPercent(metrics.excessReturn)}`;
  elements.metricDrawdown.textContent = formatPercent(metrics.maximumDrawdown);
  elements.metricDrawdownDetail.textContent = `Calmar ${metrics.calmar == null ? "—" : metrics.calmar.toFixed(2)}`;
  elements.metricSharpe.textContent = metrics.sharpe.toFixed(2);
  elements.metricSharpeDetail.textContent = `Vol ${formatPercent(metrics.annualizedVolatility)} · rf 0%`;
  elements.metricWinRate.textContent = `${(metrics.winRate * 100).toFixed(0)}%`;
  elements.metricTrades.textContent = `${metrics.trades} trades · PF ${metrics.profitFactor == null ? "—" : metrics.profitFactor.toFixed(2)}`;
  elements.metricExposure.textContent = `${(metrics.exposure * 100).toFixed(0)}%`;
}

function clearRunResult() {
  result = null;
  for (const element of [
    elements.metricReturn,
    elements.metricFinalEquity,
    elements.metricCagr,
    elements.metricCagrDetail,
    elements.metricDrawdown,
    elements.metricDrawdownDetail,
    elements.metricSharpe,
    elements.metricSharpeDetail,
    elements.metricWinRate,
    elements.metricTrades,
    elements.metricExposure,
  ]) {
    element.textContent = "—";
  }
  renderChart();
  renderTrades();
}

function applyRunResult(nextResult) {
  result = nextResult;
  renderMetrics();
  renderChart();
  renderTrades();
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function pathFor(values, xScale, yScale) {
  let path = "";
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]?.value;
    if (value == null || !Number.isFinite(value)) continue;
    const command = path ? "L" : "M";
    path += `${command}${xScale(index).toFixed(2)},${yScale(value).toFixed(2)}`;
  }
  return path;
}

function renderChart() {
  elements.chartGrid.replaceChildren();
  elements.chartSeries.replaceChildren();
  elements.chartLabels.replaceChildren();
  elements.chartLegend.replaceChildren();
  hideChartTooltip();
  if (!result) {
    elements.chartTitle.textContent = "等待有效参数";
    delete elements.chart.dataset.minimum;
    delete elements.chart.dataset.maximum;
    return;
  }
  const plot = { left: 56, right: 882, top: 18, bottom: 286 };
  let series;
  if (chartMode === "equity") {
    elements.chartTitle.textContent = "权益曲线";
    series = [
      { key: "strategy", values: result.equity, className: "series-equity", color: "#57e39a" },
      {
        key: "buy & hold",
        values: result.benchmark,
        className: "series-benchmark",
        color: "#64716b",
      },
    ];
  } else if (chartMode === "price") {
    if (result.indicators.rsi) {
      elements.chartTitle.textContent = "RSI 动量指标";
      series = [
        {
          key: "RSI",
          values: result.indicators.rsi.map((value, index) => ({
            date: bars[index].date,
            value,
          })),
          className: "series-fast",
          color: "#57e39a",
        },
      ];
    } else {
      elements.chartTitle.textContent = "价格与信号指标";
      series = [
        {
          key: "close",
          values: bars.map((bar) => ({ date: bar.date, value: bar.close })),
          className: "series-price",
          color: "#edf3ef",
        },
      ];
      if (result.indicators.fast) {
        series.push(
          {
            key: "fast SMA",
            values: result.indicators.fast.map((value, index) => ({
              date: bars[index].date,
              value,
            })),
            className: "series-fast",
            color: "#57e39a",
          },
          {
            key: "slow SMA",
            values: result.indicators.slow.map((value, index) => ({
              date: bars[index].date,
              value,
            })),
            className: "series-slow",
            color: "#f0bd66",
          },
        );
      }
      if (result.indicators.upper) {
        series.push(
          {
            key: "upper channel",
            values: result.indicators.upper.map((value, index) => ({
              date: bars[index].date,
              value,
            })),
            className: "series-fast",
            color: "#57e39a",
          },
          {
            key: "lower channel",
            values: result.indicators.lower.map((value, index) => ({
              date: bars[index].date,
              value,
            })),
            className: "series-slow",
            color: "#f0bd66",
          },
        );
      }
    }
  } else {
    elements.chartTitle.textContent = "水下回撤";
    series = [
      {
        key: "drawdown",
        values: result.metrics.drawdowns,
        className: "series-drawdown",
        color: "#f37c75",
        area: true,
      },
    ];
  }

  const allValues = series.flatMap((item) =>
    item.values
      .map((point) => point.value)
      .filter((value) => value != null && Number.isFinite(value)),
  );
  let minimum = Math.min(...allValues);
  let maximum = Math.max(...allValues);
  if (chartMode === "drawdown") maximum = 0;
  const rsiChart = chartMode === "price" && Boolean(result.indicators.rsi);
  const padding = Math.max((maximum - minimum) * 0.08, Math.abs(maximum) * 0.01, 0.01);
  if (rsiChart) {
    minimum = 0;
    maximum = 100;
  } else {
    minimum -= chartMode === "drawdown" ? padding * 0.2 : padding;
    maximum += chartMode === "drawdown" ? 0 : padding;
  }
  const xScale = (index) =>
    plot.left + (index / Math.max(1, bars.length - 1)) * (plot.right - plot.left);
  const yScale = (value) =>
    plot.bottom -
    ((value - minimum) / Math.max(0.000001, maximum - minimum)) * (plot.bottom - plot.top);

  for (let index = 0; index <= 4; index += 1) {
    const y = plot.top + (index / 4) * (plot.bottom - plot.top);
    elements.chartGrid.append(
      svgElement("line", {
        x1: plot.left,
        x2: plot.right,
        y1: y,
        y2: y,
        class: "grid-line",
      }),
    );
    const value = maximum - (index / 4) * (maximum - minimum);
    const label = svgElement("text", {
      x: plot.left - 8,
      y: y + 3,
      "text-anchor": "end",
      class: "axis-label",
    });
    label.textContent =
      chartMode === "drawdown"
        ? `${(value * 100).toFixed(0)}%`
        : chartMode === "price"
          ? formatPrice(value)
          : value >= 1000
            ? `$${(value / 1000).toFixed(0)}k`
            : `$${value.toFixed(0)}`;
    elements.chartLabels.append(label);
  }

  for (const index of [
    0,
    Math.floor((bars.length - 1) / 3),
    Math.floor(((bars.length - 1) * 2) / 3),
    bars.length - 1,
  ]) {
    const label = svgElement("text", {
      x: xScale(index),
      y: 307,
      "text-anchor": index === 0 ? "start" : index === bars.length - 1 ? "end" : "middle",
      class: "axis-label",
    });
    label.textContent = bars[index].date.slice(0, 7);
    elements.chartLabels.append(label);
  }

  for (const item of series) {
    let path = pathFor(item.values, xScale, yScale);
    if (item.area && path) {
      path += `L${plot.right},${yScale(0)}L${plot.left},${yScale(0)}Z`;
    }
    elements.chartSeries.append(svgElement("path", { d: path, class: item.className }));
    const legend = document.createElement("span");
    legend.className = "legend-item";
    const dot = document.createElement("i");
    dot.className = "legend-dot";
    dot.style.background = item.color;
    const label = document.createElement("span");
    label.textContent = item.key;
    legend.append(dot, label);
    elements.chartLegend.append(legend);
  }
  elements.chart.dataset.minimum = String(minimum);
  elements.chart.dataset.maximum = String(maximum);
}

function renderTrades() {
  elements.tradesBody.replaceChildren();
  if (!result) {
    elements.tradeSummary.textContent = "等待有效回测";
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent = "修正参数后重新运行回测";
    row.append(cell);
    elements.tradesBody.append(row);
    return;
  }
  const visibleTrades = result.trades.slice(0, 500);
  elements.tradeSummary.textContent =
    result.trades.length > visibleTrades.length
      ? `${result.trades.length} 笔已平仓交易 · 表格显示前 ${visibleTrades.length} 笔`
      : `${result.trades.length} 笔已平仓交易`;
  if (!result.trades.length) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent = "当前参数没有产生已平仓交易";
    row.append(cell);
    elements.tradesBody.append(row);
    return;
  }
  visibleTrades.forEach((trade, index) => {
    const row = document.createElement("tr");
    const values = [
      String(index + 1).padStart(2, "0"),
      trade.entryDate,
      trade.exitDate,
      formatPrice(trade.entryPrice),
      formatPrice(trade.exitPrice),
      trade.reason === "stop" ? "STOP" : trade.reason === "end" ? "END" : "SIGNAL",
      formatPercent(trade.return, 2),
      formatMoney(trade.pnl),
    ];
    values.forEach((value, cellIndex) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (cellIndex >= 6) cell.className = trade.pnl >= 0 ? "positive" : "negative";
      row.append(cell);
    });
    elements.tradesBody.append(row);
  });
  if (result.trades.length > visibleTrades.length) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent = `另有 ${result.trades.length - visibleTrades.length} 笔交易未在面板中展开；保存报告可查看前 1000 笔。`;
    row.append(cell);
    elements.tradesBody.append(row);
  }
}

function run() {
  elements.runBacktest.disabled = true;
  setRunState("RUNNING");
  try {
    applyRunResult(runBacktest(bars, currentConfiguration()));
    renderDataset();
    setRunState("COMPLETE");
    void saveUiState();
    return true;
  } catch (error) {
    clearRunResult();
    const message = error instanceof Error ? error.message : "回测失败";
    setRunState("ERROR", "error");
    notify(message, "error");
    return false;
  } finally {
    elements.runBacktest.disabled = false;
  }
}

async function loadCsv() {
  const operationWorkspaceEpoch = workspaceEpoch;
  const path = elements.dataPath.value.trim();
  if (!isSafeCsvPath(path)) {
    return notify("请输入安全的 repo 相对 CSV 路径", "error");
  }
  elements.loadData.disabled = true;
  setRunState("LOADING");
  try {
    const file = await hostCall("workspace.readText", { path });
    if (operationWorkspaceEpoch !== workspaceEpoch) return;
    const loadedBars = parseOhlcvCsv(file.content);
    const loadedResult = runBacktest(loadedBars, currentConfiguration());
    const baseName = path
      .split("/")
      .pop()
      .replace(/\.csv$/i, "")
      .slice(0, 120);
    // Read the sidecar written by app/tools/fetch-market-data.mjs. Absent or
    // unreadable metadata is not an error -- hand-placed CSVs stay loadable,
    // they just carry no declared adjustment basis.
    let meta = null;
    try {
      const sidecar = await hostCall("workspace.readText", {
        path: path.replace(/\.csv$/i, ".meta.json"),
      });
      const parsed = JSON.parse(sidecar.content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        // Only trust the declared adjustment basis if the sidecar actually
        // describes this CSV. A stale or copied sidecar would otherwise let the
        // panel report the wrong basis with full confidence.
        const actual = fingerprintBars(loadedBars);
        const matches =
          parsed.format === "codeshell.quant-dataset" &&
          typeof parsed.fingerprint === "string" &&
          parsed.fingerprint === actual;
        meta = matches ? parsed : { ...parsed, stale: true, actualFingerprint: actual };
      }
    } catch {
      meta = null;
    }
    if (operationWorkspaceEpoch !== workspaceEpoch) return;
    bars = loadedBars;
    invalidateValidation();
    dataset = {
      kind: "repo",
      path,
      name: baseName.toUpperCase(),
      source: path,
      meta,
    };
    applyRunResult(loadedResult);
    renderDataset();
    setRunState("COMPLETE");
    void saveUiState();
    notify(`已载入 ${bars.length} 根 K 线`);
  } catch (error) {
    if (operationWorkspaceEpoch !== workspaceEpoch) return;
    setRunState("ERROR", "error");
    notify(error instanceof Error ? error.message : "数据加载失败", "error");
  } finally {
    if (operationWorkspaceEpoch === workspaceEpoch) {
      elements.loadData.disabled = context.trusted !== true;
    }
  }
}

function strategyLabel(strategy) {
  if (strategy.type === "sma-cross") return `SMA ${strategy.fast}/${strategy.slow}`;
  if (strategy.type === "rsi-reversion") {
    return `RSI ${strategy.period} · ${strategy.oversold}/${strategy.overbought}`;
  }
  return `Breakout ${strategy.lookback}`;
}

function strategySlug(strategy) {
  const numberSlug = (value) => String(value).replace(".", "p");
  if (strategy.type === "sma-cross") return `sma-${strategy.fast}-${strategy.slow}`;
  if (strategy.type === "rsi-reversion") {
    return `rsi-${strategy.period}-${numberSlug(strategy.oversold)}-${numberSlug(strategy.overbought)}`;
  }
  return `breakout-${strategy.lookback}`;
}

function datasetSlug() {
  const name = dataset.kind === "demo" ? "demo" : dataset.name;
  const readable =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "dataset";
  if (dataset.kind === "demo") return readable;
  const fingerprint = fingerprintBars(bars).split(":").at(-1).slice(0, 8);
  return `${readable}-${fingerprint}`;
}

function strategySpec() {
  const configuration = currentConfiguration();
  return {
    format: "codeshell.quant-strategy",
    version: 1,
    name: `${dataset.name} ${strategyLabel(configuration.strategy)}`,
    dataset: dataset.path ?? "synthetic-demo",
    sample: {
      bars: bars.length,
      from: bars[0].date,
      to: bars.at(-1).date,
      fingerprint: fingerprintBars(bars),
    },
    // Results are only interpretable alongside the adjustment basis they came
    // from, so provenance travels with the saved spec rather than the panel.
    datasetMeta:
      dataset.kind === "demo"
        ? { adjust: "synthetic", source: "synthetic-demo" }
        : dataset.meta && dataset.meta.stale !== true
          ? {
              adjust: dataset.meta.adjust ?? "unknown",
              source: dataset.meta.source ?? "unknown",
              syncedAt: dataset.meta.syncedAt ?? null,
            }
          : { adjust: "unknown", source: dataset.path ?? "unknown" },
    strategy: configuration.strategy,
    execution: {
      initialCapital: configuration.initialCapital,
      feeBps: configuration.feeBps,
      slippageBps: configuration.slippageBps,
      stopLossPct: configuration.stopLossPct,
    },
  };
}

function configurationSlug(spec) {
  return fingerprintText(JSON.stringify({ strategy: spec.strategy, execution: spec.execution }))
    .split(":")
    .at(-1);
}

async function saveStrategy() {
  const operationWorkspaceEpoch = workspaceEpoch;
  elements.saveStrategy.disabled = true;
  try {
    if (!run()) return;
    const spec = strategySpec();
    const path = `quant/strategies/${datasetSlug()}-${strategySlug(spec.strategy)}-${configurationSlug(spec)}.quant.json`;
    await writeRepoText(path, `${JSON.stringify(spec, null, 2)}\n`);
    notify(`策略已保存到 ${path}`);
  } catch (error) {
    if (operationWorkspaceEpoch !== workspaceEpoch) return;
    notify(error instanceof Error ? error.message : "策略保存失败", "error");
  } finally {
    if (operationWorkspaceEpoch === workspaceEpoch) {
      elements.saveStrategy.disabled = context.trusted !== true;
    }
  }
}

// Surfaces the adjustment basis recorded by the sync tool, since an unlabelled
// or raw-price dataset changes how any result must be read.
function datasetAdjustNote() {
  if (dataset.kind === "demo") return "当前为合成演示数据，任何指标都不代表真实市场表现。";
  const meta = dataset.meta;
  if (!meta) return "数据集未声明复权口径，请在结论中说明该限制。";
  if (meta.stale === true) {
    return "数据集元信息与 CSV 内容不匹配（指纹不一致），复权口径不可信，请在结论中说明该限制。";
  }
  if (!meta.adjust) return "数据集未声明复权口径，请在结论中说明该限制。";
  if (meta.adjust === "none") {
    return "数据集为未复权价格，拆股与分红会扭曲结果，请在结论中明确指出。";
  }
  return `数据集复权口径：${meta.adjust}（来源 ${meta.source ?? "未知"}）。`;
}

function reportMarkdown() {
  const spec = strategySpec();
  const metrics = result.metrics;
  const quality = analyzeDataset(bars);
  const reportedTrades = result.trades.slice(0, 1_000);
  const tradeLines =
    reportedTrades.length > 0
      ? reportedTrades
          .map(
            (trade, index) =>
              `| ${index + 1} | ${trade.entryDate} | ${trade.exitDate} | ${trade.reason} | ${formatPercent(trade.return, 2)} | ${formatMoney(trade.pnl)} |`,
          )
          .concat(
            result.trades.length > reportedTrades.length
              ? [
                  `| … | — | — | omitted | — | ${result.trades.length - reportedTrades.length} additional trades |`,
                ]
              : [],
          )
          .join("\n")
      : "| — | — | — | — | — | No closed trades |";
  return [
    `# ${markdownPlainText(spec.name)}`,
    "",
    `Dataset: ${markdownInlineCode(spec.dataset)} (${bars[0].date} to ${bars.at(-1).date}, ${bars.length} daily bars)`,
    "",
    // Precise metrics without a stated adjustment basis invite misreading, so
    // provenance appears in the report itself rather than only in the panel.
    `Adjustment basis: ${markdownInlineCode(spec.datasetMeta.adjust)} · source ${markdownInlineCode(spec.datasetMeta.source)}`,
    "",
    markdownPlainText(datasetAdjustNote()),
    "",
    ...(lastValidation
      ? [
          "## Out-of-sample validation",
          "",
          `Rolling walk-forward, ${lastValidation.walk.inSampleBars} in-sample / ${lastValidation.walk.outOfSampleBars} out-of-sample bars, ${lastValidation.walk.warmupBars} warm-up bars.`,
          "",
          `- Usable folds: ${lastValidation.walk.usableFolds} of ${lastValidation.walk.folds.length}`,
          `- Mean in-sample Sharpe: ${lastValidation.walk.meanInSampleFoldSharpe?.toFixed(2) ?? "—"}`,
          `- Pooled out-of-sample Sharpe: ${lastValidation.walk.pooledOutOfSampleSharpe?.toFixed(2) ?? "—"}`,
          `- Beat benchmark in ${lastValidation.walk.beatBenchmarkRate == null ? "—" : `${(lastValidation.walk.beatBenchmarkRate * 100).toFixed(0)}%`} of folds`,
          ...(lastValidation.walk.untestedTailBars > 0
            ? [
                `- ${lastValidation.walk.untestedTailBars} most recent bars fall outside every scored fold and were never validated.`,
              ]
            : []),
          "",
          "Out-of-sample figures are the ones to judge. In-sample results reflect parameter",
          "selection as much as signal.",
          "",
        ]
      : [
          "## Out-of-sample validation",
          "",
          "Not run. The metrics below are in-sample only and cannot distinguish a working",
          "strategy from an overfitted one.",
          "",
        ]),
    "## Data checks",
    "",
    quality.warnings.length === 0
      ? "All built-in data checks passed."
      : `${quality.warnings.length} warning(s):`,
    ...quality.warnings.map((warning) => `- ${warning.code}: ${warning.message}`),
    "",
    "## Configuration",
    "",
    fencedMarkdown(JSON.stringify(spec, null, 2), "json"),
    "",
    "## Results",
    "",
    `- Final equity: ${formatMoney(metrics.finalEquity)}`,
    `- Total return: ${formatPercent(metrics.totalReturn)}`,
    `- Annualized return: ${formatPercent(metrics.annualizedReturn)}`,
    `- Buy-and-hold return: ${formatPercent(metrics.benchmarkReturn)}`,
    `- Excess return: ${formatPercent(metrics.excessReturn)}`,
    `- Annualized volatility: ${formatPercent(metrics.annualizedVolatility)}`,
    `- Maximum drawdown: ${formatPercent(metrics.maximumDrawdown)}`,
    `- Sharpe ratio: ${metrics.sharpe.toFixed(2)}`,
    `- Calmar ratio: ${metrics.calmar == null ? "n/a" : metrics.calmar.toFixed(2)}`,
    `- Profit factor: ${metrics.profitFactor == null ? "n/a" : metrics.profitFactor.toFixed(2)}`,
    `- Average trade return: ${formatPercent(metrics.averageTradeReturn)}`,
    `- Exposure: ${(metrics.exposure * 100).toFixed(1)}%`,
    `- Win rate: ${(metrics.winRate * 100).toFixed(1)}% (${metrics.trades} trades)`,
    "",
    "## Trades",
    "",
    "| # | Entry | Exit | Reason | Return | P&L |",
    "|---:|---|---|---|---:|---:|",
    tradeLines,
    "",
    "## Methodology and limitations",
    "",
    "Signals are computed after a daily close and execute at the next bar's open. The test is long-only and includes the configured fees, slippage, and simplified intraday stop behavior.",
    "",
    "This research output is not investment advice. Validate adjusted pricing, data quality, liquidity, corporate actions, survivorship bias, and out-of-sample performance before drawing conclusions.",
    "",
  ].join("\n");
}

async function saveReport() {
  const operationWorkspaceEpoch = workspaceEpoch;
  elements.saveReport.disabled = true;
  try {
    if (!run()) return;
    const spec = strategySpec();
    const path = `quant/reports/${datasetSlug()}-${strategySlug(spec.strategy)}-${configurationSlug(spec)}-report.md`;
    await writeRepoText(path, reportMarkdown());
    notify(`报告已保存到 ${path}`);
  } catch (error) {
    if (operationWorkspaceEpoch !== workspaceEpoch) return;
    notify(error instanceof Error ? error.message : "报告保存失败", "error");
  } finally {
    if (operationWorkspaceEpoch === workspaceEpoch) {
      elements.saveReport.disabled = context.trusted !== true;
    }
  }
}

function updateParameterVisibility() {
  const type = elements.strategyType.value;
  elements.smaParams.hidden = type !== "sma-cross";
  elements.rsiParams.hidden = type !== "rsi-reversion";
  elements.breakoutParams.hidden = type !== "breakout";
}

function saveUiState(workspaceRoot = context.cwd ?? null) {
  let configuration;
  try {
    configuration = currentConfiguration();
  } catch {
    return Promise.resolve();
  }
  const value = {
    ...configurationStorageValue,
    workspaceRoot,
    ...configuration,
    inSampleBars: Number(elements.wfInSample.value),
    outOfSampleBars: Number(elements.wfOutSample.value),
    dataPath: elements.dataPath.value.trim(),
  };
  configurationStorageValue = value;
  return hostCall("storage.set", {
    key: scopedStorageKey("configuration", workspaceRoot ?? "preview"),
    value,
  }).catch(() => undefined);
}

function resetUiState() {
  elements.strategyType.value = "sma-cross";
  elements.fastPeriod.value = "20";
  elements.slowPeriod.value = "50";
  elements.rsiPeriod.value = "14";
  elements.rsiOversold.value = "30";
  elements.rsiOverbought.value = "65";
  elements.breakoutPeriod.value = "20";
  elements.initialCapital.value = "100000";
  elements.feeBps.value = "5";
  elements.slippageBps.value = "2";
  elements.stopLoss.value = "8";
  elements.signalMode.value = "state";
  elements.sizerType.value = "all-in";
  elements.sizerPct.value = "50";
  elements.sizerAnnual.value = "15";
  elements.sizerLookback.value = "20";
  elements.riskFreeRate.value = "0";
  elements.wfInSample.value = "504";
  elements.wfOutSample.value = "126";
  elements.dataPath.value = "";
  syncSizerFields();
  invalidateValidation();
}

function restoreUiState(value) {
  if (!value || typeof value !== "object") return;
  const strategy = value.strategy;
  if (["sma-cross", "rsi-reversion", "breakout"].includes(strategy?.type)) {
    elements.strategyType.value = strategy.type;
  }
  if (strategy?.fast != null) elements.fastPeriod.value = strategy.fast;
  if (strategy?.slow != null) elements.slowPeriod.value = strategy.slow;
  if (strategy?.period != null) elements.rsiPeriod.value = strategy.period;
  if (strategy?.oversold != null) elements.rsiOversold.value = strategy.oversold;
  if (strategy?.overbought != null) elements.rsiOverbought.value = strategy.overbought;
  if (strategy?.lookback != null) elements.breakoutPeriod.value = strategy.lookback;
  if (value.initialCapital != null) elements.initialCapital.value = value.initialCapital;
  if (value.feeBps != null) elements.feeBps.value = value.feeBps;
  if (value.slippageBps != null) elements.slippageBps.value = value.slippageBps;
  if (value.stopLossPct != null) elements.stopLoss.value = value.stopLossPct;
  if (typeof value.dataPath === "string") elements.dataPath.value = value.dataPath;
  if (["state", "edge"].includes(value.signalMode)) elements.signalMode.value = value.signalMode;
  const sizer = value.sizer;
  if (["all-in", "fixed-fraction", "volatility-target"].includes(sizer?.type)) {
    elements.sizerType.value = sizer.type;
    if (sizer.pct != null) elements.sizerPct.value = sizer.pct;
    if (sizer.annual != null) elements.sizerAnnual.value = sizer.annual;
    if (sizer.lookback != null) elements.sizerLookback.value = sizer.lookback;
  }
  // Stored as a decimal; the field shows a percentage.
  if (Number.isFinite(value.riskFreeRate)) {
    elements.riskFreeRate.value = String(Math.round(value.riskFreeRate * 1000) / 10);
  }
  if (Number.isFinite(value.inSampleBars)) elements.wfInSample.value = value.inSampleBars;
  if (Number.isFinite(value.outOfSampleBars)) elements.wfOutSample.value = value.outOfSampleBars;
  syncSizerFields();
  updateParameterVisibility();
}

async function restoreWorkspaceState(workspaceIdentity, storageRoot, epoch) {
  const saved = await hostCall("storage.get", {
    key: scopedStorageKey("configuration", storageRoot),
  }).catch(() => null);
  if (epoch !== workspaceEpoch || (context.cwd ?? null) !== workspaceIdentity) return;
  configurationStorageValue =
    saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  resetUiState();
  restoreUiState(saved?.workspaceRoot === workspaceIdentity ? saved : null);
  const savedWatch = await hostCall("storage.get", { key: watchStorageKey() }).catch(() => null);
  if (epoch !== workspaceEpoch || (context.cwd ?? null) !== workspaceIdentity) return;
  await restoreWatchlistState(savedWatch);
  if (epoch !== workspaceEpoch || (context.cwd ?? null) !== workspaceIdentity) return;
  await holdingsController.load(epoch);
  if (epoch !== workspaceEpoch || (context.cwd ?? null) !== workspaceIdentity) return;
  await newsController.load(epoch);
  if (epoch !== workspaceEpoch || (context.cwd ?? null) !== workspaceIdentity) return;
  await notesController.load(epoch);
  if (epoch !== workspaceEpoch || (context.cwd ?? null) !== workspaceIdentity) return;
  holdingsController.refreshRules();
  notesController.render();
  await restoreActiveModule(storageRoot, epoch);
  if (epoch !== workspaceEpoch || (context.cwd ?? null) !== workspaceIdentity) return;
  await alertsController.load();
  updateParameterVisibility();
  renderDataset();
  run();
}

function updateChartTooltip(event) {
  if (!result) return;
  const rect = elements.chart.getBoundingClientRect();
  const relativeX = (event.clientX - rect.left) / rect.width;
  const plotStart = 56 / 900;
  const plotEnd = 882 / 900;
  const normalized = Math.max(0, Math.min(1, (relativeX - plotStart) / (plotEnd - plotStart)));
  const index = Math.round(normalized * (bars.length - 1));
  const x = 56 + (index / Math.max(1, bars.length - 1)) * (882 - 56);
  elements.chartCursor.setAttribute("x1", x);
  elements.chartCursor.setAttribute("x2", x);
  elements.chartCursor.hidden = false;
  let body;
  if (chartMode === "equity") {
    body = [
      bars[index].date,
      formatMoney(result.equity[index].value),
      `benchmark ${formatMoney(result.benchmark[index].value)}`,
    ];
  } else if (chartMode === "price") {
    body = result.indicators.rsi
      ? [
          bars[index].date,
          `RSI ${result.indicators.rsi[index]?.toFixed(1) ?? "—"}`,
          `close ${formatPrice(bars[index].close)}`,
        ]
      : [
          bars[index].date,
          formatPrice(bars[index].close),
          `volume ${Math.round(bars[index].volume).toLocaleString()}`,
        ];
  } else {
    body = [bars[index].date, formatPercent(result.metrics.drawdowns[index].value, 2)];
  }
  elements.chartTooltip.replaceChildren();
  body.forEach((line, lineIndex) => {
    const row = document.createElement(lineIndex === 1 ? "strong" : "span");
    row.textContent = line;
    elements.chartTooltip.append(row);
  });
  elements.chartTooltip.style.left = `${Math.min(rect.width - 140, Math.max(8, event.clientX - rect.left + 10))}px`;
  elements.chartTooltip.style.top = `${Math.max(8, event.clientY - rect.top - 20)}px`;
  elements.chartTooltip.hidden = false;
}

function hideChartTooltip() {
  elements.chartCursor.hidden = true;
  elements.chartTooltip.hidden = true;
}

async function submitAgentRequest() {
  const operationWorkspaceEpoch = workspaceEpoch;
  const request = elements.agentRequest.value.trim();
  if (!request) return notify("先填写希望 Agent 处理的问题", "error");
  if (context.busy) return notify("当前会话正在运行，请稍后再提交", "error");
  if (!run()) return;
  elements.submitAgent.disabled = true;
  try {
    const spec = strategySpec();
    const summary = result
      ? `当前结果：总收益 ${formatPercent(result.metrics.totalReturn)}，最大回撤 ${formatPercent(result.metrics.maximumDrawdown)}，Sharpe ${result.metrics.sharpe.toFixed(2)}。`
      : "";
    // Attach engine-computed evidence so the agent interprets real numbers
    // instead of inferring them from a prose summary.
    let evidenceBlock = "";
    if (result) {
      try {
        const evidence = researchEvidence(result, {
          walkForward: lastValidation?.walk ?? null,
          sweep: lastValidation?.sweep ?? null,
        });
        evidenceBlock = [
          "",
          "以下证据由回测引擎计算得出，请直接引用，不要自行重算：",
          fencedMarkdown(JSON.stringify(evidence, null, 2), "json"),
        ].join("\n");
      } catch {
        evidenceBlock = "";
      }
    }
    const prompt = [
      "请处理下面的量化研究请求。",
      dataset.path
        ? `数据文件：${dataset.path}（${bars[0].date} 至 ${bars.at(-1).date}，${bars.length} 根日线）`
        : "当前面板使用合成演示数据；如需真实分析，请先准备 repo 内的 OHLCV CSV，并记录来源和截止日期。",
      `策略配置：${JSON.stringify(spec)}`,
      summary,
      datasetAdjustNote(),
      "明确检查前视偏差、复权、交易成本、样本外验证和过拟合风险。不要把回测结果表述为投资建议。",
      "所有数值必须来自下方证据；若证据缺失请说明无法判断，不要估算。",
      evidenceBlock,
      "",
      `我的要求：${request}`,
    ].filter(Boolean).join("\n");
    await hostCall("agent.submitPrompt", { prompt });
    if (operationWorkspaceEpoch !== workspaceEpoch) return;
    elements.agentDialog.close();
    notify("已提交给当前 Agent");
  } catch (error) {
    if (operationWorkspaceEpoch !== workspaceEpoch) return;
    notify(error instanceof Error ? error.message : "提交失败", "error");
  } finally {
    if (operationWorkspaceEpoch === workspaceEpoch) {
      elements.submitAgent.disabled = context.busy;
    }
  }
}

function updateContext(next) {
  const previousWorkspaceRoot = typeof context.cwd === "string" ? context.cwd : null;
  const nextContext = { ...context, ...(next ?? {}) };
  const nextWorkspaceRoot = typeof nextContext.cwd === "string" ? nextContext.cwd : null;
  const workspaceChanged = contextInitialized && previousWorkspaceRoot !== nextWorkspaceRoot;
  if (workspaceChanged) {
    void saveUiState(previousWorkspaceRoot);
    configurationStorageValue = {};
    bars = generateDemoBars();
    dataset = {
      kind: "demo",
      path: null,
      name: "DEMO / SYNTHETIC",
      source: "synthetic sample",
    };
    watchlist = [];
    watchlistStorageValue = { items: [] };
    watchMigrationBlocked = false;
    watchMigrationConflicts = [];
    hasPortfolioPositions = false;
    portfolioTodayState = {
      ledgerExists: false,
      hasPositions: false,
      summary: null,
      analysis: null,
      rules: [],
      dataStatus: {
        status: "unavailable",
        reason: "workspace-switching",
        source: "portfolio/transactions.json",
        availableAt: null,
        stale: false,
        provisional: false,
      },
    };
    holdingsController.reset();
    alertsController?.reset();
    newsController?.reset();
    notesController?.reset();
    notesDecisionFacts = {
      status: "unavailable",
      reason: "workspace-switching",
      source: "portfolio/journal.json",
    };
    renderWatchlist();
    renderWatchMigrationState();
    activateModule("today", { focusTarget: "none", persist: false });
    clearRunResult();
    workspaceEpoch += 1;
  }
  context = nextContext;
  contextInitialized = true;
  const workspaceUnavailable = context.trusted !== true;
  elements.loadData.disabled = workspaceUnavailable;
  elements.saveStrategy.disabled = workspaceUnavailable;
  elements.saveReport.disabled = workspaceUnavailable;
  elements.askAgent.disabled = Boolean(context.busy);
  elements.submitAgent.disabled = Boolean(context.busy);
  elements.agentState.textContent = context.busy
    ? "当前会话忙碌中"
    : context.trusted === false
      ? "工作区尚未信任"
      : "当前会话可用";
  if (workspaceChanged) {
    setRunState("SWITCHING");
    notify("工作区已切换；旧仓库行情已清除，正在载入新仓库参数");
    void restoreWorkspaceState(nextWorkspaceRoot, nextWorkspaceRoot ?? "preview", workspaceEpoch);
  }
}

elements.runBacktest.addEventListener("click", run);
elements.loadData.addEventListener("click", () => void loadCsv());
elements.dataPath.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void loadCsv();
});
// HTML-escape for innerHTML interpolation. markdownPlainText also escapes
// markdown punctuation, which would surface as stray backslashes in the DOM.
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}


// --- Watchlist ------------------------------------------------------------
// Entries live in panel storage, keyed per workspace. Each carries the rule it
// should fire on; evaluation always re-reads the CSV so an alert reflects the
// data on disk rather than whatever was last backtested.

let watchlist = [];
let watchlistStorageValue = { items: [] };
let watchMigrationBlocked = false;
let watchMigrationConflicts = [];

function watchStorageKey() {
  return scopedStorageKey("watchlist", context.cwd ?? "preview");
}

function canonicalWatchSymbol(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  const upper = raw.toUpperCase();
  const cn = /^(SH|SZ)?(\d{6})$/u.exec(upper);
  if (cn) {
    const [, declaredExchange, bare] = cn;
    const inferredExchange = /^(6|9)/u.test(bare)
      ? "SH"
      : /^(0|2|3)/u.test(bare)
        ? "SZ"
        : null;
    if (!inferredExchange) {
      return { ok: false, symbol: raw, reason: `无法判断 ${raw} 的 A 股交易所` };
    }
    if (declaredExchange && declaredExchange !== inferredExchange) {
      return { ok: false, symbol: raw, reason: `${raw} 的交易所前缀与代码不一致` };
    }
    return { ok: true, symbol: `${inferredExchange}${bare}` };
  }
  if (/^[A-Z][A-Z0-9.-]{0,9}$/u.test(upper)) return { ok: true, symbol: upper };
  return { ok: false, symbol: raw, reason: `无法无损规范化代码 ${raw || "（空）"}` };
}

function isWatchItem(item) {
  return Boolean(item && typeof item === "object" && typeof item.symbol === "string" && item.rule);
}

// Lossless, re-entrant canonicalization of the stored watchlist. Only an exact
// duplicate (same canonical symbol, rule type and every other field) is dropped;
// entries whose fields differ are both kept and reported as a conflict, so the
// user resolves it by deleting one instead of the migration deciding for them.
function migrateWatchlistStorage(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const sourceItems = Array.isArray(source.items) ? source.items : [];
  const { watchlistMigrationConflicts: _previousConflicts, ...envelope } = source;
  const items = [];
  const conflicts = [];
  const seenRules = new Map();
  for (const [index, item] of sourceItems.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item) || !item.rule) {
      conflicts.push({ index, code: "invalid-item", message: `第 ${index + 1} 条关注记录结构无效` });
      items.push(item);
      continue;
    }
    const canonical = canonicalWatchSymbol(item.symbol);
    const nextItem = canonical.ok ? { ...item, symbol: canonical.symbol } : { ...item };
    if (!canonical.ok) {
      conflicts.push({ index, code: "invalid-symbol", message: canonical.reason });
      items.push(nextItem);
      continue;
    }
    const ruleType = typeof item.rule.type === "string" ? item.rule.type : "invalid";
    const ruleKey = `${canonical.symbol}:${ruleType}`;
    const existing = seenRules.get(ruleKey);
    if (existing == null) {
      seenRules.set(ruleKey, items.length);
      items.push(nextItem);
      continue;
    }
    const first = items[existing];
    const comparable = (entry) => {
      const { id: _id, symbol: _symbol, ...rest } = entry;
      return JSON.stringify(rest);
    };
    if (comparable(first) !== comparable(nextItem)) {
      conflicts.push({
        index,
        code: "duplicate-rule-conflict",
        message: `${canonical.symbol} 的 ${ruleType} 规则字段冲突；两条都已保留${first.id ? `（第一条 ${first.id}）` : ""}，请删除其一`,
      });
      items.push(nextItem);
    }
  }
  const migrated = {
    ...envelope,
    items,
    watchlistMigrationVersion: 1,
    ...(conflicts.length > 0 ? { watchlistMigrationConflicts: conflicts } : {}),
  };
  return {
    value: migrated,
    changed: JSON.stringify(migrated) !== JSON.stringify(source),
    conflicts,
  };
}

function renderWatchMigrationState() {
  if (watchMigrationConflicts.length > 0) {
    elements.watchMigrationState.textContent = `关注迁移有 ${watchMigrationConflicts.length} 项冲突：${watchMigrationConflicts.map((item) => item.message).join("；")}。每日提醒保持原状，处理冲突前不会重建。`;
    elements.watchMigrationState.hidden = false;
    elements.watchSchedule.disabled = true;
    alertsController?.render();
    return;
  }
  if (watchMigrationBlocked) {
    elements.watchMigrationState.textContent = "关注迁移未能写回 storage；已继续显示原记录，每日提醒保持原状。";
    elements.watchMigrationState.hidden = false;
    elements.watchSchedule.disabled = true;
    alertsController?.render();
    return;
  }
  elements.watchMigrationState.hidden = true;
  elements.watchMigrationState.textContent = "";
  elements.watchSchedule.disabled = false;
  alertsController?.render();
}

async function restoreWatchlistState(savedWatch) {
  watchMigrationBlocked = false;
  watchMigrationConflicts = [];
  if (!savedWatch || typeof savedWatch !== "object" || Array.isArray(savedWatch)) {
    watchlistStorageValue = { items: [] };
    watchlist = [];
    renderWatchlist();
    renderWatchMigrationState();
    return;
  }
  const migration = migrateWatchlistStorage(savedWatch);
  watchlistStorageValue = migration.value;
  watchlist = migration.value.items.filter(isWatchItem);
  watchMigrationConflicts = migration.conflicts;
  if (migration.changed) {
    try {
      await hostCall("storage.set", { key: watchStorageKey(), value: migration.value });
    } catch {
      watchlistStorageValue = savedWatch;
      watchlist = Array.isArray(savedWatch.items) ? savedWatch.items.filter(isWatchItem) : [];
      watchMigrationBlocked = true;
    }
  }
  renderWatchlist();
  renderWatchMigrationState();
}

// Rules that need a number expose the threshold field; the others hide it.
function syncWatchThresholdField() {
  const rule = elements.watchRule.value;
  const needsThreshold = rule === "price-below" || rule === "drawdown-from-high";
  elements.watchThreshold.hidden = !needsThreshold;
  elements.watchThreshold.placeholder = rule === "price-below" ? "价格" : "回撤 %";
  if (!needsThreshold) elements.watchThreshold.value = "";
}

function watchRuleFor(type, threshold) {
  if (type === "price-below") return { type, price: threshold };
  if (type === "drawdown-from-high") return { type, pct: threshold, lookback: 252 };
  if (type === "rsi-oversold") return { type, period: 14, threshold: 30 };
  return { type: "signal-entry" };
}

function watchRuleLabel(rule) {
  if (rule.type === "price-below") return `跌破 ${rule.price}`;
  if (rule.type === "drawdown-from-high") return `回撤 ${rule.pct}%`;
  if (rule.type === "rsi-oversold") return `RSI < ${rule.threshold}`;
  return "策略买入信号";
}

// The CSV a watch entry reads. Mirrors the sync tool's output layout.
function watchDataPath(symbol) {
  return `data/market/${symbol}.csv`;
}

// Every user edit goes through the same canonicalization as the migration, so
// a conflict clears as soon as the user deletes one side of it, and a write that
// was blocked at startup is retried with the user's explicit change.
async function saveWatchlist() {
  const migration = migrateWatchlistStorage({ ...watchlistStorageValue, items: watchlist });
  watchlistStorageValue = migration.value;
  watchlist = migration.value.items.filter(isWatchItem);
  watchMigrationConflicts = migration.conflicts;
  renderWatchlist();
  try {
    await hostCall("storage.set", { key: watchStorageKey(), value: watchlistStorageValue });
    watchMigrationBlocked = false;
  } catch {
    // Keep the in-memory list; the banner (if any) already says storage is stale.
  }
  renderWatchMigrationState();
}

function renderWatchlist() {
  if (watchlist.length === 0) {
    elements.watchlistItems.innerHTML =
      '<p class="watchlist-empty">还没有关注的标的。添加后可按规则检查触发状态。</p>';
    elements.watchlistSummary.textContent = "未添加";
    renderToday();
    alertsController?.render();
    return;
  }
  const triggered = watchlist.filter((item) => item.last?.triggered).length;
  elements.watchlistSummary.textContent = triggered
    ? `${triggered} 个触发 · 共 ${watchlist.length}`
    : `${watchlist.length} 个关注中`;
  elements.watchlistItems.innerHTML = watchlist
    .map((item, index) => {
      const last = item.last;
      const state = last?.error ? "error" : last?.triggered ? "hit" : last ? "idle" : "pending";
      const detail = last?.error ?? last?.detail ?? "尚未检查";
      const price = last && !last.error ? `${last.close.toFixed(2)}` : "—";
      const change =
        last && !last.error && Number.isFinite(last.changePct)
          ? `<span class="watch-change" data-dir="${last.changePct >= 0 ? "up" : "down"}">${formatPercent(last.changePct)}</span>`
          : "";
      return `<div class="watch-item" data-state="${state}" tabindex="-1">
        <div class="watch-item-head">
          <b>${escapeHtml(item.name || item.symbol)}</b>
          ${item.name ? `<span class="watch-code">${escapeHtml(item.symbol)}</span>` : ""}
          <span class="watch-rule">${escapeHtml(watchRuleLabel(item.rule))}</span>
          <span class="watch-price">${price}${change}</span>
          <button class="watch-remove" type="button" data-index="${index}" aria-label="移除">×</button>
        </div>
        <p class="watch-detail">${escapeHtml(detail)}</p>
      </div>`;
    })
    .join("");
  renderToday();
  alertsController?.render();
}

function addWatchItem() {
  const rawSymbol = elements.watchSymbol.value.trim().toUpperCase();
  if (!rawSymbol) return notify("请填写标的代码", "error");
  if (!/^[A-Z0-9.:-]{1,24}$/.test(rawSymbol)) return notify("代码含有非法字符", "error");
  // Store the same canonical form the migration produces (SH600519 / AAPL), so
  // the entry matches the sync tool's file name and never re-migrates on load.
  const canonical = canonicalWatchSymbol(rawSymbol);
  const symbol = canonical.ok ? canonical.symbol : rawSymbol;
  if (watchlist.some((item) => item.symbol === symbol && item.rule.type === elements.watchRule.value)) {
    return notify("该标的的同类提醒已存在", "error");
  }
  if (watchlist.length >= 100) return notify("关注列表已满（上限 100）", "error");

  const type = elements.watchRule.value;
  let threshold = null;
  if (type === "price-below" || type === "drawdown-from-high") {
    threshold = Number(elements.watchThreshold.value);
    if (!Number.isFinite(threshold) || threshold <= 0) return notify("请填写有效阈值", "error");
  }
  let rule;
  try {
    rule = watchRuleFor(type, threshold);
  } catch (error) {
    return notify(error instanceof Error ? error.message : "规则无效", "error");
  }

  watchlist.push({
    symbol,
    rule,
    // Snapshot the current strategy so a signal alert keeps firing on the rule
    // the user validated, even after they change the panel's settings.
    strategy: type === "signal-entry" ? currentStrategy() : null,
    last: null,
  });
  elements.watchSymbol.value = "";
  elements.watchThreshold.value = "";
  renderWatchlist();
  void saveWatchlist();
  notify(`已关注 ${symbol}`);
}

function removeWatchItem(index) {
  if (index < 0 || index >= watchlist.length) return;
  const [removed] = watchlist.splice(index, 1);
  renderWatchlist();
  void saveWatchlist();
  notify(`已移除 ${removed.symbol}`);
}

async function checkWatchlist() {
  if (watchlist.length === 0) return notify("请先添加关注标的", "error");
  const operationWorkspaceEpoch = workspaceEpoch;
  elements.watchCheck.disabled = true;
  try {
    for (const item of watchlist) {
      try {
        const file = await hostCall("workspace.readText", { path: watchDataPath(item.symbol) });
        if (operationWorkspaceEpoch !== workspaceEpoch) return;
        const itemBars = parseOhlcvCsv(file.content);
        const evaluated = evaluateWatchItem(itemBars, item);
        item.last = {
          ...evaluated,
          id: item.id ?? `${item.symbol}:${item.rule?.type ?? evaluated.rule}`,
          threshold: item.rule,
          source: watchDataPath(item.symbol),
          availableAt: evaluated.asOf,
          checkedAt: currentInstant().toISOString(),
          stale: false,
          provisional: false,
        };
        // Pick up the display name from the sidecar so the list reads as names
        // rather than codes. Absent metadata just leaves the code showing.
        try {
          const sidecar = await hostCall("workspace.readText", {
            path: watchDataPath(item.symbol).replace(/\.csv$/i, ".meta.json"),
          });
          const meta = JSON.parse(sidecar.content);
          if (meta && typeof meta.name === "string" && meta.name) item.name = meta.name;
          if (meta && typeof meta === "object") {
            item.last.stale = meta.stale === true;
            item.last.provisional = meta.provisional === true;
            item.last.availableAt = meta.availableAt ?? meta.syncedAt ?? item.last.availableAt;
          }
        } catch {
          // No sidecar: keep showing the code.
        }
      } catch (error) {
        // A missing CSV is the common case, not a crash: the user has not
        // synced that symbol yet. Say so instead of failing the whole run.
        item.last = {
          error:
            error instanceof Error && /not found|ENOENT|读取|missing/i.test(error.message)
              ? `缺少 ${watchDataPath(item.symbol)}，请先同步该标的数据`
              : error instanceof Error
                ? error.message
                : "检查失败",
        };
      }
    }
    if (operationWorkspaceEpoch !== workspaceEpoch) return;
    // Order entries by their evaluation so triggers surface first, then the
    // ones closest to triggering.
    const order = new Map(
      rankWatchResults(
        watchlist.filter((item) => item.last && !item.last.error).map((item) => item.last),
      ).map((result, index) => [result, index]),
    );
    watchlist.sort((a, b) => {
      const left = a.last && !a.last.error ? (order.get(a.last) ?? Infinity) : Infinity;
      const right = b.last && !b.last.error ? (order.get(b.last) ?? Infinity) : Infinity;
      return left - right;
    });
    renderWatchlist();
    void saveWatchlist();
    holdingsController.refreshRules();
    const hits = watchlist.filter((item) => item.last?.triggered).length;
    notify(hits ? `${hits} 个标的触发提醒` : "没有标的触发提醒");
  } finally {
    if (operationWorkspaceEpoch === workspaceEpoch) elements.watchCheck.disabled = false;
  }
}

alertsController = createAlertsController({
  hostCall,
  watchlist: () => watchlist,
  notify,
  blocked: () => watchMigrationBlocked || watchMigrationConflicts.length > 0,
  elements: {
    master: elements.watchSchedule,
    summary: elements.watchScheduleState,
    markets: {
      cn: {
        root: elements.watchAutomationCn,
        time: elements.watchAutomationCnTime,
        status: elements.watchAutomationCnStatus,
        button: elements.watchAutomationCnAction,
      },
      us: {
        root: elements.watchAutomationUs,
        time: elements.watchAutomationUsTime,
        status: elements.watchAutomationUsStatus,
        button: elements.watchAutomationUsAction,
      },
    },
    legacy: elements.watchLegacyAutomation,
    legacyState: elements.watchLegacyState,
    legacyRemove: elements.watchLegacyRemove,
  },
});

newsController = createNewsController({
  hostCall,
  root: elements.newsRoot,
  currentEpoch: () => workspaceEpoch,
  now: currentInstant,
  subscriptionSymbols() {
    const merged = [];
    for (const item of holdingsController.subscriptionSymbols()) {
      merged.push({ ...item, origins: ["holding"] });
    }
    for (const item of watchlist) {
      const market = /^(?:SH|SZ)\d{6}$/u.test(item.symbol) ? "cn" : "us";
      merged.push({ symbol: item.symbol, market, origins: ["watch"] });
    }
    return merged;
  },
  onRecordNote(link) {
    openNotes(link);
  },
  noteLinkCount(link) {
    return linkedNoteCount(link);
  },
});

function openNotes(link = null) {
  activateModule("notes", { focusTarget: "none" });
  queueMicrotask(() => notesController?.prefill(link));
}

function linkedNoteCount(target) {
  return (notesController?.state.document?.entries ?? []).filter((note) => note.links.some((link) =>
    link.type === target.type &&
    (link.type === "instrument" ? link.symbol === target.symbol && link.market === target.market
      : link.type === "transaction" ? link.transactionId === target.transactionId
        : link.type === "news" ? link.newsItemId === target.newsItemId
          : link.ruleId === target.ruleId))).length;
}

notesController = createNotesController({
  hostCall,
  root: elements.notesRoot,
  currentEpoch: () => workspaceEpoch,
  now: currentInstant,
  context() {
    return {
      ...holdingsController.noteContext(),
      news: newsController.state.feed,
    };
  },
  onChange(facts) {
    notesDecisionFacts = facts;
    holdingsController.refreshRules();
    newsController.refreshNoteCounts();
    renderToday();
  },
});

// Grid searched during out-of-sample validation. Ranges bracket the configured
// value so the sweep reports whether the neighbourhood supports it, rather than
// only whether one point scored well.
function validationRanges(strategy) {
  if (strategy.type === "sma-cross") {
    const fast = [5, 10, 20, 30].filter((value) => value < strategy.slow);
    const slow = [30, 50, 100, 150].filter((value) => value > Math.min(...fast));
    return { fast: fast.length ? fast : [strategy.fast], slow: slow.length ? slow : [strategy.slow] };
  }
  if (strategy.type === "rsi-reversion") {
    return { period: [7, 14, 21], oversold: [20, 30], overbought: [65, 75] };
  }
  return { lookback: [10, 20, 40, 60] };
}

// How often the walk-forward picked a different parameter set. Constant churn
// means there is no stable optimum, which is overfitting in its plainest form.
function parameterChurn(walk) {
  const usable = walk.folds.filter((fold) => fold.ok);
  if (usable.length < 2) return null;
  let changes = 0;
  for (let i = 1; i < usable.length; i += 1) {
    if (JSON.stringify(usable[i].parameters) !== JSON.stringify(usable[i - 1].parameters)) {
      changes += 1;
    }
  }
  return changes / (usable.length - 1);
}

function stabilityLabel(walk) {
  const churn = parameterChurn(walk);
  if (churn == null) return "—";
  if (churn <= 0.25) return "稳定";
  if (churn <= 0.6) return "一般";
  return "不稳定";
}

function stabilityTone(walk) {
  const churn = parameterChurn(walk);
  if (churn == null) return "";
  return churn <= 0.25 ? "good" : churn <= 0.6 ? "" : "bad";
}

function validationTone(value, threshold) {
  if (value == null || !Number.isFinite(value)) return "";
  return value >= threshold ? "good" : "bad";
}

// Turns the numbers into the judgement the user actually came for. Reads only
// engine output; every clause traces to a computed value, never a guess.
function computeVerdict(walk, sweep) {
  if (!walk) {
    return {
      state: "unvalidated",
      badge: "未验证",
      line: "当前指标只反映样本内表现，无法区分「策略有效」和「参数拟合」。",
      reasons: [],
      action: "点击左栏「运行样本外验证」得到可信结论。",
    };
  }
  if (walk.usableFolds === 0) {
    return {
      state: "unusable",
      badge: "无法判断",
      line: "没有任何有效的验证折，样本外结论不可用。",
      reasons: walk.folds
        .filter((fold) => !fold.ok)
        .slice(0, 2)
        .map((fold) => fold.error ?? "折验证失败"),
      action: "证据限制：当前样本长度不足以形成有效的样本外评分。",
    };
  }

  const reasons = [];
  const oos = walk.pooledOutOfSampleSharpe;
  const beat = walk.beatBenchmarkRate;
  const churn = parameterChurn(walk);
  let failures = 0;

  if (oos != null && oos <= 0) {
    failures += 1;
    reasons.push(`样本外 Sharpe ${oos.toFixed(2)}，风险调整后没有正收益。`);
  } else if (oos != null && oos < 0.5) {
    reasons.push(`样本外 Sharpe 仅 ${oos.toFixed(2)}，优势微弱。`);
  }
  if (beat != null && beat < 0.5) {
    failures += 1;
    reasons.push(`只有 ${(beat * 100).toFixed(0)}% 的样本外区间跑赢买入持有，择时不如不动。`);
  }
  if (walk.degradation != null && walk.degradation > 0.5) {
    failures += 1;
    reasons.push(`Sharpe 从样本内到样本外下滑 ${walk.degradation.toFixed(2)}，成绩主要来自参数拟合。`);
  }
  if (churn != null && churn > 0.6) {
    failures += 1;
    reasons.push(`各折选出的最优参数有 ${(churn * 100).toFixed(0)}% 在变，不存在稳定最优解。`);
  }
  if (sweep && sweep.sharpeStdDev != null && sweep.sharpeMax - sweep.sharpeMean > 2 * sweep.sharpeStdDev) {
    reasons.push("最佳参数是扫描中的孤立高点，邻域表现不支持它。");
  }
  if (walk.untestedTailBars > 0) {
    reasons.push(`最近 ${walk.untestedTailBars} 根 K 线不在任何评分窗口内，未被验证。`);
  }

  if (failures >= 2) {
    return {
      state: "bad",
      badge: "证据不足",
      line: "样本外证据显示这套参数没有可靠优势。",
      reasons,
      action: "证据限制：当前信号与参数未通过样本外稳健性检查。",
    };
  }
  if (failures === 1 || reasons.length > 0) {
    return {
      state: "weak",
      badge: "存疑",
      line: "样本外表现勉强站得住，但存在需要正视的问题。",
      reasons,
      action: "证据限制：结论受上述问题影响，需要更长样本才能复核。",
    };
  }
  return {
    state: "ok",
    badge: "通过验证",
    line: "样本外表现与样本内一致，未发现明显过拟合迹象。",
    reasons: [
      `样本外 Sharpe ${oos?.toFixed(2) ?? "—"}，跑赢基准 ${beat == null ? "—" : `${(beat * 100).toFixed(0)}%`}。`,
    ],
    action: "证据限制：通过验证不代表未来有效，后续数据仍可能改变结论。",
  };
}

function renderVerdict(walk, sweep) {
  const verdict = computeVerdict(walk, sweep);
  elements.verdict.dataset.state = verdict.state;
  elements.verdictBadge.textContent = verdict.badge;
  elements.verdictLine.textContent = verdict.line;
  elements.verdictReasons.innerHTML = verdict.reasons
    .map((reason) => `<li>${escapeHtml(reason)}</li>`)
    .join("");
  elements.verdictAction.textContent = verdict.action;
}

function renderValidation(walk, sweep) {
  const fmt = (value, digits = 2) =>
    value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
  const pct = (value) =>
    value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(0)}%`;

  const stats = [
    [
      "样本外 Sharpe",
      fmt(walk.pooledOutOfSampleSharpe),
      validationTone(walk.pooledOutOfSampleSharpe, 0),
      "只用没参与选参的数据算出的风险调整收益。这是唯一能反映真实表现的数字。",
    ],
    [
      "样本内 Sharpe",
      fmt(walk.meanInSampleFoldSharpe),
      "",
      "在用来挑参数的那段数据上的表现。必然偏高，仅作对照。",
    ],
    // Degradation is IS minus OOS: large positive means the in-sample figure was
    // mostly parameter selection. Negative means OOS held up, which is not a
    // warning, so only flag the positive side.
    [
      "退化",
      fmt(walk.degradation),
      walk.degradation == null || !Number.isFinite(walk.degradation)
        ? ""
        : walk.degradation > 0.5
          ? "bad"
          : "good",
      "样本内 Sharpe 减样本外 Sharpe。数值越大，说明好成绩越依赖参数拟合。超过 0.5 视为过拟合信号。",
    ],
    [
      "跑赢基准",
      pct(walk.beatBenchmarkRate),
      validationTone(walk.beatBenchmarkRate, 0.5),
      "有多少比例的样本外区间跑赢了同期买入持有。低于 50% 意味着择时不如不动。",
    ],
    [
      "参数稳定性",
      stabilityLabel(walk),
      stabilityTone(walk),
      "各折选出的最优参数是否一致。频繁跳动说明没有稳定的最优解，是过拟合的直接证据。",
    ],
    [
      "有效折数",
      `${walk.usableFolds}/${walk.folds.length}`,
      "",
      "成功完成评分的滚动窗口数量。",
    ],
  ];

  const notes = [];
  if (walk.usableFolds === 0) notes.push("没有任何有效折，样本外结论不可用。");
  if (walk.degradation != null && walk.degradation > 0.5) {
    notes.push(`Sharpe 从样本内到样本外下滑 ${fmt(walk.degradation)}，存在过拟合迹象。`);
  }
  if (walk.beatBenchmarkRate != null && walk.beatBenchmarkRate < 0.5) {
    notes.push(`仅 ${pct(walk.beatBenchmarkRate)} 的样本外区间跑赢买入持有。`);
  }
  if (walk.failedFolds > 0) notes.push(`${walk.failedFolds} 折因参数不适用被排除。`);
  if (walk.untestedTailBars > 0) {
    notes.push(`最近 ${walk.untestedTailBars} 根 K 线不在任何评分窗口内，从未被验证。`);
  }
  if (sweep && sweep.sharpeStdDev != null && sweep.sharpeMax - sweep.sharpeMean > 2 * sweep.sharpeStdDev) {
    notes.push("最佳参数是扫描中的孤立高点，邻域不支持该结果。");
  }

  const foldRows = walk.folds
    .map((fold) => {
      if (!fold.ok) {
        return `<tr><td>${escapeHtml(fold.from)} → ${escapeHtml(fold.to)}</td><td colspan="5">${escapeHtml(fold.error ?? "失败")}</td></tr>`;
      }
      const params = Object.entries(fold.parameters)
        .map(([key, value]) => `${key} ${value}`)
        .join(" / ");
      return `<tr>
        <td>${escapeHtml(fold.from)} → ${escapeHtml(fold.to)}</td>
        <td>${escapeHtml(params)}</td>
        <td>${fmt(fold.inSampleSharpe)}</td>
        <td>${fmt(fold.outOfSampleSharpe)}</td>
        <td>${formatPercent(fold.outOfSampleReturn)}</td>
        <td>${formatPercent(fold.benchmarkReturn)}</td>
      </tr>`;
    })
    .join("");

  elements.validationBody.innerHTML = `
    <div class="validation-headline">
      ${stats
        .map(
          ([label, value, tone, hint]) =>
            `<div class="validation-stat"${hint ? ` title="${escapeHtml(hint)}"` : ""}><span>${label}</span><b${tone ? ` data-tone="${tone}"` : ""}>${value}</b></div>`,
        )
        .join("")}
    </div>
    <p class="validation-verdict"${notes.length === 0 ? ' data-tone="ok"' : ""}>
      ${
        notes.length === 0
          ? "样本外表现与样本内一致，未发现明显过拟合迹象。这不代表策略在未来有效。"
          : `<b>需要注意：</b><ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`
      }
    </p>
    <details class="validation-detail">
      <summary>逐折明细（${walk.folds.length} 折）</summary>
      <table class="validation-folds">
        <thead>
          <tr><th>样本外区间</th><th>选中参数</th><th>IS Sharpe</th><th>OOS Sharpe</th><th>策略</th><th>基准</th></tr>
        </thead>
        <tbody>${foldRows}</tbody>
      </table>
    </details>`;

  elements.validationSummary.textContent =
    walk.usableFolds > 0
      ? `${walk.usableFolds} 折 · 样本外 Sharpe ${fmt(walk.pooledOutOfSampleSharpe)}`
      : "无有效折";
  elements.validationCard.hidden = false;
  renderVerdict(walk, sweep);
}

// Validation is tied to one dataset and one configuration; any change makes the
// displayed folds stale, so drop them rather than let them describe a stale run.
function invalidateValidation() {
  if (lastValidation === null && elements.validationCard.hidden) return;
  lastValidation = null;
  elements.validationCard.hidden = true;
  elements.validationBody.innerHTML = "";
  elements.validationSummary.textContent = "未运行";
  renderVerdict(null, null);
}

function runValidation() {
  if (bars.length === 0) return notify("请先加载数据", "error");
  let configuration;
  try {
    configuration = currentConfiguration();
  } catch (error) {
    return notify(error instanceof Error ? error.message : "参数无效", "error");
  }
  const inSampleBars = numberValue(elements.wfInSample, "样本内长度", {
    minimum: 30,
    maximum: 100_000,
  });
  const outOfSampleBars = numberValue(elements.wfOutSample, "样本外长度", {
    minimum: 10,
    maximum: 100_000,
  });
  if (bars.length < inSampleBars + outOfSampleBars) {
    return notify(
      `数据不足：需要至少 ${inSampleBars + outOfSampleBars} 根 K 线，当前 ${bars.length} 根`,
      "error",
    );
  }

  elements.runValidation.disabled = true;
  setRunState("VALIDATING");
  // Yield once so the disabled state paints before the sweep blocks the thread.
  window.setTimeout(() => {
    try {
      const ranges = validationRanges(configuration.strategy);
      const walk = walkForward(bars, configuration, ranges, { inSampleBars, outOfSampleBars });
      const sweep = parameterSweep(bars, configuration, ranges);
      lastValidation = { walk, sweep };
      renderValidation(walk, sweep);
      setRunState("COMPLETE");
      notify(`样本外验证完成：${walk.usableFolds} 折`);
    } catch (error) {
      lastValidation = null;
      setRunState("ERROR", "error");
      notify(error instanceof Error ? error.message : "验证失败", "error");
    } finally {
      elements.runValidation.disabled = false;
    }
  }, 0);
}

elements.strategyType.addEventListener("change", () => {
  updateParameterVisibility();
  invalidateValidation();
  run();
});
for (const input of [
  elements.fastPeriod,
  elements.slowPeriod,
  elements.rsiPeriod,
  elements.rsiOversold,
  elements.rsiOverbought,
  elements.breakoutPeriod,
  elements.initialCapital,
  elements.feeBps,
  elements.slippageBps,
  elements.stopLoss,
  elements.sizerPct,
  elements.sizerAnnual,
  elements.sizerLookback,
  elements.riskFreeRate,
]) {
  input.addEventListener("input", () => {
    invalidateValidation();
    setRunState("PARAMS CHANGED");
  });
}
elements.signalMode.addEventListener("change", () => {
  invalidateValidation();
  run();
});
elements.sizerType.addEventListener("change", () => {
  syncSizerFields();
  invalidateValidation();
  run();
});
elements.runValidation.addEventListener("click", runValidation);
elements.watchRule.addEventListener("change", syncWatchThresholdField);
elements.watchAdd.addEventListener("click", addWatchItem);
elements.watchSymbol.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addWatchItem();
});
elements.watchlistItems.addEventListener("click", (event) => {
  const button = event.target.closest(".watch-remove");
  if (button) removeWatchItem(Number(button.dataset.index));
});
elements.watchCheck.addEventListener("click", () => void checkWatchlist());
syncSizerFields();
syncWatchThresholdField();
renderWatchlist();
elements.saveStrategy.addEventListener("click", () => void saveStrategy());
elements.saveReport.addEventListener("click", () => void saveReport());
elements.askAgent.addEventListener("click", () => elements.agentDialog.showModal());
elements.submitAgent.addEventListener("click", () => void submitAgentRequest());
for (const [index, tab] of moduleTabs.entries()) {
  tab.addEventListener("click", () => {
    activateModule(tab.dataset.moduleTab, { focusTarget: "tab" });
  });
  tab.addEventListener("keydown", (event) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const targetIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? moduleTabs.length - 1
          : delta
            ? (index + delta + moduleTabs.length) % moduleTabs.length
            : -1;
    if (targetIndex < 0) return;
    event.preventDefault();
    activateModule(moduleTabs[targetIndex].dataset.moduleTab, { focusTarget: "tab" });
  });
}
for (const button of document.querySelectorAll("[data-module-link]")) {
  button.addEventListener("click", () => {
    const target = button.dataset.moduleLink;
    const todayFocus = button === elements.todayPrimaryAction ? button.dataset.focusTarget : null;
    activateModule(target, { focusTarget: todayFocus ? "none" : "heading" });
    if (todayFocus === "portfolio-entry") {
      queueMicrotask(() => holdingsController.openEntry());
    } else if (todayFocus === "portfolio-analysis") {
      queueMicrotask(() => document.querySelector("#portfolio-analysis")?.focus());
    } else if (todayFocus === "watch-trigger") {
      queueMicrotask(() =>
        (document.querySelector('.watch-item[data-state="hit"]') ??
          document.querySelector("#module-watch-title"))?.focus(),
      );
    } else if (todayFocus === "watch-heading") {
      queueMicrotask(() => document.querySelector("#module-watch-title")?.focus());
    } else if (todayFocus === "research-heading") {
      queueMicrotask(() => document.querySelector("#module-research-title")?.focus());
    } else if (target === "holdings") {
      queueMicrotask(() => holdingsController.focusPrimary());
    }
  });
}
const chartTabs = [...document.querySelectorAll("[data-chart]")];
function activateChartTab(button, { focus = false } = {}) {
  chartMode = button.dataset.chart;
  for (const candidate of chartTabs) {
    const active = candidate === button;
    candidate.classList.toggle("active", active);
    candidate.setAttribute("aria-selected", String(active));
    candidate.tabIndex = active ? 0 : -1;
  }
  elements.chartWrap.setAttribute("aria-labelledby", button.id);
  if (focus) button.focus();
  renderChart();
}
for (const [index, button] of chartTabs.entries()) {
  button.addEventListener("click", () => activateChartTab(button));
  button.addEventListener("keydown", (event) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const targetIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? chartTabs.length - 1
          : delta
            ? (index + delta + chartTabs.length) % chartTabs.length
            : -1;
    if (targetIndex < 0) return;
    event.preventDefault();
    activateChartTab(chartTabs[targetIndex], { focus: true });
  });
}
for (const button of document.querySelectorAll("[data-prompt]")) {
  button.addEventListener("click", () => {
    elements.agentRequest.value = button.dataset.prompt;
    elements.agentRequest.focus();
  });
}
elements.chart.addEventListener("pointermove", updateChartTooltip);
elements.chart.addEventListener("pointerleave", hideChartTooltip);
window.addEventListener("keydown", (event) => {
  if (event.defaultPrevented) return;
  const activeTag = document.activeElement?.tagName;
  const interactive = ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(activeTag);
  if (event.key === "Enter" && !interactive && !elements.agentDialog.open) run();
});

async function initialize() {
  try {
    if (window.codeshellPanel?.getContext) updateContext(await window.codeshellPanel.getContext());
    else updateContext({ busy: false, trusted: true, cwd: "/preview/codeshell" });
    window.codeshellPanel?.on?.("context.changed", updateContext);
  } catch {
    updateContext({ busy: false, trusted: false });
  }
  const initializationWorkspaceEpoch = workspaceEpoch;
  const initializationWorkspaceIdentity = context.cwd ?? null;
  const initializationWorkspaceRoot = initializationWorkspaceIdentity ?? "preview";
  await restoreWorkspaceState(
    initializationWorkspaceIdentity,
    initializationWorkspaceRoot,
    initializationWorkspaceEpoch,
  );
}

void initialize();
