const MAX_CONDITIONS = 4;
const OPERATORS = Object.freeze([">", ">=", "<", "<=", "==", "!="]);

export const SELECTION_SIGNAL_FIELDS = Object.freeze([
  Object.freeze({ id: "relativeScore", label: "相对强度分", unit: "score", read: (row) => row.relativeScore }),
  Object.freeze({ id: "changePercent", label: "当日涨跌", unit: "percent", read: (row) => row.changePercent }),
  Object.freeze({ id: "return20", label: "20 日涨跌", unit: "percent", read: (row) => row.metrics?.return20 }),
  Object.freeze({ id: "return60", label: "60 日涨跌", unit: "percent", read: (row) => row.metrics?.return60 }),
  Object.freeze({ id: "extension20", label: "距 MA20", unit: "percent", read: (row) => row.metrics?.extension20 }),
  Object.freeze({ id: "volumeRatio", label: "量比", unit: "ratio", read: (row) => row.metrics?.volumeRatio }),
  Object.freeze({ id: "turnover", label: "换手率", unit: "percent", read: (row) => row.turnover }),
  Object.freeze({ id: "pe", label: "市盈率", unit: "number", read: (row) => row.pe }),
  Object.freeze({ id: "pb", label: "市净率", unit: "number", read: (row) => row.pb }),
  Object.freeze({ id: "patternScore", label: "四维形态分", unit: "score", read: (row) => row.patternEvidence?.score }),
  Object.freeze({
    id: "deviationCloseness",
    label: "异动偏离接近度",
    unit: "percent",
    read(row) {
      const deviation = row.abnormalDeviation;
      if (!deviation?.available) return null;
      return deviation.windows?.find((item) => item.days === deviation.leadingWindowDays)?.closeness ?? null;
    },
  }),
]);

const FIELD_BY_ID = new Map(SELECTION_SIGNAL_FIELDS.map((field) => [field.id, field]));
const DEFAULT_SIGNAL = Object.freeze({
  version: 1,
  mode: "and",
  conditions: Object.freeze([
    Object.freeze({ field: "return20", operator: ">", value: 0 }),
    Object.freeze({ field: "extension20", operator: "<=", value: 8 }),
    Object.freeze({ field: "volumeRatio", operator: ">=", value: 0.75 }),
  ]),
});

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 1_000_000_000) throw new Error(`${label}无效`);
  return number;
}

export function normalizeSelectionSignal(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : DEFAULT_SIGNAL;
  const mode = source.mode === "or" ? "or" : "and";
  const input = Array.isArray(source.conditions) ? source.conditions : DEFAULT_SIGNAL.conditions;
  if (input.length < 1 || input.length > MAX_CONDITIONS) throw new Error(`筛选条件需为 1–${MAX_CONDITIONS} 条`);
  const conditions = input.map((condition, index) => {
    const field = String(condition?.field ?? "");
    const operator = String(condition?.operator ?? "");
    if (!FIELD_BY_ID.has(field)) throw new Error(`第 ${index + 1} 条筛选字段无效`);
    if (!OPERATORS.includes(operator)) throw new Error(`第 ${index + 1} 条运算符无效`);
    return Object.freeze({ field, operator, value: finite(condition?.value, `第 ${index + 1} 条阈值`) });
  });
  return Object.freeze({ version: 1, mode, conditions: Object.freeze(conditions) });
}

function compare(left, operator, right) {
  if (operator === ">") return left > right;
  if (operator === ">=") return left >= right;
  if (operator === "<") return left < right;
  if (operator === "<=") return left <= right;
  if (operator === "==") return left === right;
  return left !== right;
}

function uniqueResearchRows(snapshot) {
  const bySymbol = new Map();
  for (const sector of Array.isArray(snapshot?.sectors) ? snapshot.sectors : []) {
    for (const [pool, rows] of [
      ["代表股", sector.representatives],
      ["已确认", sector.candidates],
      ["等待", sector.timingQueue],
    ]) {
      for (const candidate of Array.isArray(rows) ? rows : []) {
        if (!candidate?.symbol) continue;
        const current = bySymbol.get(candidate.symbol);
        if (!current || Number(candidate.relativeScore) > Number(current.candidate.relativeScore)) {
          bySymbol.set(candidate.symbol, { sector, candidate, pool });
        }
      }
    }
  }
  return [...bySymbol.values()];
}

export function evaluateSelectionSignal(snapshot, input) {
  const signal = normalizeSelectionSignal(input);
  const rows = uniqueResearchRows(snapshot).map(({ sector, candidate, pool }) => {
    const checks = signal.conditions.map((condition) => {
      const field = FIELD_BY_ID.get(condition.field);
      const raw = field.read(candidate);
      const actual = Number.isFinite(Number(raw)) ? Number(raw) : null;
      return Object.freeze({
        ...condition,
        label: field.label,
        unit: field.unit,
        actual,
        available: actual != null,
        passed: actual == null ? false : compare(actual, condition.operator, condition.value),
      });
    });
    const passed = signal.mode === "and" ? checks.every((item) => item.passed) : checks.some((item) => item.passed);
    return Object.freeze({ sector, candidate, pool, checks: Object.freeze(checks), passed });
  });
  const matches = rows.filter((row) => row.passed).sort((left, right) =>
    Number(right.candidate.relativeScore) - Number(left.candidate.relativeScore) ||
    String(left.candidate.symbol).localeCompare(String(right.candidate.symbol)),
  );
  return Object.freeze({
    version: 1,
    marketDate: snapshot?.marketDate ?? null,
    signal,
    poolCount: rows.length,
    matches: Object.freeze(matches),
    unavailableChecks: rows.reduce((total, row) => total + row.checks.filter((item) => !item.available).length, 0),
    disclosure: "只筛当前选股快照中的板块研究池，不等于全市场扫描，也不代表策略已通过历史验证。",
  });
}

function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function selectionSignalCsv(evaluation) {
  if (!evaluation || !Array.isArray(evaluation.matches)) throw new Error("自定义筛选结果无效");
  const conditionText = evaluation.signal.conditions.map((condition) => {
    const field = FIELD_BY_ID.get(condition.field);
    return `${field?.label ?? condition.field} ${condition.operator} ${condition.value}`;
  }).join(evaluation.signal.mode === "and" ? " AND " : " OR ");
  const rows = [[
    "market_date", "mode", "conditions", "sector", "pool", "symbol", "name",
    "relative_score", "state", "matched_values",
  ]];
  for (const result of evaluation.matches) {
    rows.push([
      evaluation.marketDate,
      evaluation.signal.mode,
      conditionText,
      result.sector.name,
      result.pool,
      result.candidate.symbol,
      result.candidate.name,
      result.candidate.relativeScore,
      result.candidate.stateLabel,
      result.checks.map((check) => `${check.label}=${check.actual ?? "缺失"}`).join("; "),
    ]);
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function node(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function formatValue(value, unit) {
  if (!Number.isFinite(value)) return "—";
  if (unit === "percent") return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
  if (unit === "ratio") return value.toFixed(2);
  if (unit === "score") return value.toFixed(0);
  return value.toFixed(Math.abs(value) >= 100 ? 0 : 2);
}

export function createSelectionSignalLabController({
  hostCall,
  storageKey,
  getSnapshot,
  onStock,
  notify = () => undefined,
  now = () => new Date(),
  elements,
}) {
  let signal = normalizeSelectionSignal(DEFAULT_SIGNAL);
  let loaded = false;
  let latestEvaluation = null;

  function save() {
    if (!loaded) return;
    void hostCall("storage.set", { key: storageKey(), value: signal }).catch(() => {
      notify("自定义筛选条件未能保存", "error");
    });
  }

  function renderConditions() {
    elements.conditions.replaceChildren();
    signal.conditions.forEach((condition, index) => {
      const row = node("div", "selection-signal-condition");
      row.dataset.conditionIndex = String(index);
      const field = node("select");
      field.setAttribute("aria-label", `条件 ${index + 1} 字段`);
      field.dataset.signalField = String(index);
      field.replaceChildren(...SELECTION_SIGNAL_FIELDS.map((spec) => {
        const option = node("option", "", spec.label);
        option.value = spec.id;
        option.selected = spec.id === condition.field;
        return option;
      }));
      const operator = node("select");
      operator.setAttribute("aria-label", `条件 ${index + 1} 运算符`);
      operator.dataset.signalOperator = String(index);
      operator.replaceChildren(...OPERATORS.map((value) => {
        const option = node("option", "", value);
        option.value = value;
        option.selected = value === condition.operator;
        return option;
      }));
      const threshold = node("input");
      threshold.type = "number";
      threshold.step = "0.01";
      threshold.value = String(condition.value);
      threshold.setAttribute("aria-label", `条件 ${index + 1} 阈值`);
      threshold.dataset.signalValue = String(index);
      const remove = node("button", "", "移除");
      remove.type = "button";
      remove.dataset.signalRemove = String(index);
      remove.disabled = signal.conditions.length === 1;
      row.append(field, operator, threshold, remove);
      elements.conditions.append(row);
    });
    elements.add.disabled = signal.conditions.length >= MAX_CONDITIONS;
  }

  function renderResults() {
    const snapshot = getSnapshot();
    latestEvaluation = null;
    elements.results.replaceChildren();
    if (!snapshot) {
      elements.export.disabled = true;
      elements.count.textContent = "等待选股";
      elements.summary.textContent = "先生成或恢复一份今日选股快照，再按条件筛当前研究池。";
      elements.results.append(node("p", "selection-empty", "暂无可筛选的研究池。"));
      return;
    }
    const evaluation = evaluateSelectionSignal(snapshot, signal);
    latestEvaluation = evaluation;
    elements.export.disabled = evaluation.matches.length === 0;
    elements.count.textContent = `${evaluation.matches.length} / ${evaluation.poolCount} 只`;
    elements.summary.textContent = evaluation.poolCount
      ? `${evaluation.marketDate} · ${signal.mode === "and" ? "全部条件同时满足" : "任一条件满足"} · 命中 ${evaluation.matches.length} 只${evaluation.unavailableChecks ? ` · ${evaluation.unavailableChecks} 个缺失值按未命中处理` : ""}`
      : "当前选股快照没有板块研究样本。";
    if (!evaluation.matches.length) {
      elements.results.append(node("p", "selection-empty", "当前研究池没有命中；可放宽阈值或改用“任一条件”。"));
      return;
    }
    for (const result of evaluation.matches.slice(0, 12)) {
      const card = node("article", "selection-signal-result");
      const identity = node("div");
      identity.append(
        node("b", "", result.candidate.name),
        node("small", "", `${result.candidate.symbol} · ${result.sector.name} · ${result.pool}`),
      );
      const checks = node("div", "selection-signal-result-checks");
      checks.append(...result.checks.map((check) => {
        const chip = node("span", "", `${check.label} ${check.operator} ${formatValue(check.value, check.unit)} · 当前 ${formatValue(check.actual, check.unit)}`);
        chip.dataset.state = check.passed ? "passed" : check.available ? "missed" : "missing";
        return chip;
      }));
      const open = node("button", "", "打开个股研究");
      open.type = "button";
      open.dataset.signalStock = result.candidate.symbol;
      open.dataset.signalStockName = result.candidate.name;
      card.append(identity, checks, open);
      elements.results.append(card);
    }
  }

  function render() {
    elements.mode.value = signal.mode;
    renderConditions();
    renderResults();
  }

  function updateCondition(index, patch) {
    if (!Number.isInteger(index) || index < 0 || index >= signal.conditions.length) return;
    try {
      const conditions = signal.conditions.map((condition, candidate) => candidate === index ? { ...condition, ...patch } : condition);
      signal = normalizeSelectionSignal({ ...signal, conditions });
      save();
      renderResults();
    } catch (error) {
      notify(error instanceof Error ? error.message : "筛选条件无效", "error");
    }
  }

  elements.mode.addEventListener("change", () => {
    signal = normalizeSelectionSignal({ ...signal, mode: elements.mode.value });
    save();
    renderResults();
  });
  elements.add.addEventListener("click", () => {
    if (signal.conditions.length >= MAX_CONDITIONS) return;
    signal = normalizeSelectionSignal({
      ...signal,
      conditions: [...signal.conditions, { field: "relativeScore", operator: ">=", value: 60 }],
    });
    save();
    render();
  });
  elements.reset.addEventListener("click", () => {
    signal = normalizeSelectionSignal(DEFAULT_SIGNAL);
    save();
    render();
    notify("已恢复稳健观察模板");
  });
  elements.export.addEventListener("click", async () => {
    if (!latestEvaluation?.matches.length) return;
    elements.export.disabled = true;
    try {
      const stamp = now().toISOString().replace(/\D/gu, "").slice(0, 14);
      const path = `data/selection-exports/${latestEvaluation.marketDate}-custom-signal-${stamp}.csv`;
      const content = selectionSignalCsv(latestEvaluation);
      await hostCall("workspace.writeText", { path, content, expectedModifiedAt: null });
      const verified = await hostCall("workspace.readText", { path });
      if (verified?.content !== content) throw new Error("导出文件写回校验失败");
      notify(`已直接导出 ${latestEvaluation.matches.length} 只命中结果`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "自定义筛选导出失败", "error");
    } finally {
      elements.export.disabled = !latestEvaluation?.matches.length;
    }
  });
  elements.conditions.addEventListener("change", (event) => {
    const field = event.target.closest("[data-signal-field]");
    if (field) {
      updateCondition(Number(field.dataset.signalField), { field: field.value });
      return;
    }
    const operator = event.target.closest("[data-signal-operator]");
    if (operator) {
      updateCondition(Number(operator.dataset.signalOperator), { operator: operator.value });
      return;
    }
    const threshold = event.target.closest("[data-signal-value]");
    if (threshold) updateCondition(Number(threshold.dataset.signalValue), { value: threshold.value });
  });
  elements.conditions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-signal-remove]");
    if (!button || signal.conditions.length === 1) return;
    signal = normalizeSelectionSignal({
      ...signal,
      conditions: signal.conditions.filter((_, index) => index !== Number(button.dataset.signalRemove)),
    });
    save();
    render();
  });
  elements.results.addEventListener("click", (event) => {
    const button = event.target.closest("[data-signal-stock]");
    if (!button) return;
    onStock({ symbol: button.dataset.signalStock, name: button.dataset.signalStockName });
  });

  return Object.freeze({
    async load() {
      try {
        const saved = await hostCall("storage.get", { key: storageKey() });
        if (saved) signal = normalizeSelectionSignal(saved);
      } catch {
        signal = normalizeSelectionSignal(DEFAULT_SIGNAL);
      }
      loaded = true;
      render();
    },
    render: renderResults,
    reset() {
      loaded = false;
      signal = normalizeSelectionSignal(DEFAULT_SIGNAL);
      render();
    },
    get signal() {
      return signal;
    },
  });
}
