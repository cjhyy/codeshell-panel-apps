const money = (value) => value == null ? "—" : `${Number(value) > 0 ? "+" : ""}${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percent = (value) => value == null ? "—" : `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
const tone = (value) => value == null || Number(value) === 0 ? "neutral" : Number(value) > 0 ? "positive" : "negative";
const reasonText = (row) => row.baseline && !row.reason ? "建账基准" : ({
  "negative-cash": "需补充入金记录", "missing-fx": "缺少汇率", "fx-age-exceeded": "汇率需更新",
  "missing-previous-valuation": "缺少前日估值", "non-positive-equity": "缺少有效本金",
  "suspected-missing-corporate-action": "需核对除权记录",
}[row.reason] ?? (row.reason ? "缺少历史行情" : row.live ? "最新报价估算" : row.provisional ? "暂估" : "日终"));
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const svgNode = (tag, attributes, text) => {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text != null) element.textContent = text;
  return element;
};

export function performanceWindow(rows, range) {
  if (range === "all" || !rows.length) return rows;
  const days = range === "90" ? 90 : 30;
  const cutoff = new Date(`${rows.at(-1).date}T00:00:00Z`).getTime() - (days - 1) * 86_400_000;
  return rows.filter((row) => Date.parse(`${row.date}T00:00:00Z`) >= cutoff);
}

export function createPortfolioPerformanceView(root) {
  if (!root) return { render() {}, reset() {} };
  const chart = root.querySelector(".portfolio-performance-chart");
  const body = root.querySelector("tbody");
  const status = root.querySelector(".portfolio-performance-status");
  const detail = root.querySelector(".portfolio-performance-cursor");
  const daily = root.querySelector("[data-performance-daily]");
  const rate = root.querySelector("[data-performance-return]");
  const date = root.querySelector("[data-performance-date]");
  let rows = [];
  let range = "30";
  const describe = (row) => `${row.date} · 当日收益 ${money(row.dailyPnl)} 元 · 当日收益率 ${percent(row.dailyReturn)} · 累计 ${percent(row.cumulativeReturn)} · ${reasonText(row)}`;
  function draw() {
    const selected = performanceWindow(rows, range);
    const latest = rows.at(-1);
    date.textContent = latest ? `${latest.date} · ${reasonText(latest)}` : "等待持仓记录";
    daily.textContent = money(latest?.dailyPnl);
    daily.dataset.tone = tone(latest?.dailyPnl);
    rate.textContent = percent(latest?.cumulativeReturn);
    rate.dataset.tone = tone(latest?.cumulativeReturn);
    detail.textContent = latest ? describe(latest) : "";
    chart.replaceChildren();
    body.replaceChildren();
    const valid = selected.filter((row) => row.cumulativeReturn != null);
    const missing = selected.filter((row) => row.reason).length;
    status.textContent = !rows.length ? "录入持仓后显示每日收益。"
      : valid.length === 1 && rows.length === 1 ? "已建立收益基准；后续有完整行情的日期会延伸曲线。导入前的每日收益无法由持仓快照还原。"
      : missing ? `${missing} 天缺少完整计算依据；缺失收益显示为“—”，曲线不会跨过数据缺口。可补齐历史行情后重算。`
      : "收益已扣除入金、出金与持仓转入转出的影响；盘中数值为估算。";
    if (!valid.length) {
      chart.append(node("p", "暂无可绘制的收益率。补齐账本期间的历史行情和资金记录后即可显示。", "portfolio-performance-empty"));
    } else {
      const width = Math.max(320, Math.min(720, chart.clientWidth || 720)), height = 230, left = 62, right = 18, top = 20, bottom = 32;
      let low = Math.min(0, ...valid.map((row) => row.cumulativeReturn));
      let high = Math.max(0, ...valid.map((row) => row.cumulativeReturn));
      if (high - low < 0.002) { low -= 0.001; high += 0.001; }
      const x = (index) => selected.length === 1 ? (width + left - right) / 2 : left + index / (selected.length - 1) * (width - left - right);
      const y = (value) => top + (high - value) / (high - low) * (height - top - bottom);
      const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "累计收益率曲线；每日数值可在下方表格查看" });
      for (let index = 0; index < 4; index++) {
        const value = low + (high - low) * index / 3;
        svg.append(svgNode("line", { x1: left, x2: width - right, y1: y(value), y2: y(value), class: "performance-grid" }));
        svg.append(svgNode("text", { x: left - 8, y: y(value) + 4, "text-anchor": "end", class: "performance-axis" }, `${(value * 100).toFixed(2)}%`));
      }
      let path = "";
      let connected = false;
      selected.forEach((row, index) => {
        if (row.cumulativeReturn == null) { connected = false; return; }
        path += `${connected ? "L" : "M"}${x(index).toFixed(2)},${y(row.cumulativeReturn).toFixed(2)} `;
        connected = true;
      });
      svg.append(svgNode("path", { d: path, class: "performance-line", fill: "none" }));
      selected.forEach((row, index) => {
        if (row.cumulativeReturn == null) return;
        const point = svgNode("circle", { cx: x(index), cy: y(row.cumulativeReturn), r: selected.length > 90 ? 3 : 4,
          class: "performance-point", tabindex: "0", role: "button", "aria-label": describe(row) });
        point.append(svgNode("title", {}, describe(row)));
        for (const event of ["pointerenter", "focus", "click"]) point.addEventListener(event, () => { detail.textContent = describe(row); });
        svg.append(point);
      });
      for (const [index, anchor] of [[0, "start"], [selected.length - 1, "end"]]) {
        if (selected.length === 1 && anchor === "end") continue;
        svg.append(svgNode("text", { x: x(index), y: height - 8, "text-anchor": selected.length === 1 ? "middle" : anchor, class: "performance-axis" }, selected[index].date));
      }
      chart.append(svg);
    }
    for (const row of [...selected].reverse()) {
      const tr = node("tr");
      for (const [text, value] of [[row.date, null], [money(row.dailyPnl), row.dailyPnl], [percent(row.dailyReturn), row.dailyReturn], [percent(row.cumulativeReturn), row.cumulativeReturn], [reasonText(row), null]]) {
        const td = node("td", text);
        if (value != null) td.dataset.tone = tone(value);
        tr.append(td);
      }
      body.append(tr);
    }
  }
  root.querySelectorAll("[data-performance-range]").forEach((button) => button.addEventListener("click", () => {
    range = button.dataset.performanceRange;
    root.querySelectorAll("[data-performance-range]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    draw();
  }));
  window.addEventListener("resize", () => { if (root.getClientRects().length) draw(); });
  return { render(next) { rows = next; draw(); }, reset() { rows = []; draw(); } };
}
