import {
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_ORDER,
  SOCIAL_RADAR_HISTORY_DIRECTORY,
  SOCIAL_RADAR_PATH,
  buildSocialRadarTask,
  normalizeSocialRadarTaskResult,
  parseSocialRadarSnapshot,
  socialRadarArchivePath,
  socialRadarMetrics,
  socialRadarTrend,
} from "../social-radar.mjs";

const INVESTMENT_RESEARCH_SKILL = "quant-lab:investment-research";

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function timeLabel(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function windowLabel(hours) {
  return hours === 24 ? "最近 24 小时" : hours === 720 ? "最近 30 天" : "最近 7 天";
}

function stanceLabel(stance) {
  if (stance === "bullish") return "偏多样本";
  if (stance === "bearish") return "偏空样本";
  if (stance === "neutral") return "中性样本";
  return "立场不明";
}

function coverageLabel(status) {
  if (status === "sampled") return "找到公开样本";
  if (status === "no-indexed-results") return "未找到索引结果";
  if (status === "blocked") return "页面访问受限";
  if (status === "not-checked") return "本轮未覆盖";
  return "本轮来源不可用";
}

function taskError(task) {
  if (task?.status === "cancelled") return "公开社媒扫描已取消";
  if (task?.status === "failed") return String(task.error || task.result?.text || "公开社媒扫描失败").slice(0, 500);
  const reason = String(task?.result?.reason ?? "");
  if (!reason || reason === "completed") return "";
  if (reason === "model_error") return "模型请求失败，请检查模型与 Web Search 连接";
  if (reason === "prompt_too_long") return "社媒扫描超过模型上下文限制";
  if (reason === "max_turns") return "社媒扫描达到执行轮数上限，尚未形成可校验结果";
  return `公开社媒扫描未正常完成（${reason.slice(0, 80)}）`;
}

function expectedWriteParams(file) {
  if (!file?.exists) return { expectedModifiedAt: null };
  if (typeof file.revision === "string") return { expectedRevision: file.revision };
  return { expectedModifiedAt: file.modifiedAt };
}

export function createSocialRadarController({
  hostCall,
  onHostEvent,
  currentEpoch,
  now = () => new Date(),
  notify = () => undefined,
  onBusyChange = () => undefined,
  root,
}) {
  const byId = (id) => root.querySelector(`#${id}`);
  const elements = {
    target: byId("social-radar-target"),
    window: byId("social-radar-window"),
    run: byId("social-radar-run"),
    state: byId("social-radar-state"),
    status: byId("social-radar-status"),
    result: byId("social-radar-result"),
    title: byId("social-radar-result-title"),
    meta: byId("social-radar-result-meta"),
    summary: byId("social-radar-summary"),
    metrics: byId("social-radar-metrics"),
    trend: byId("social-radar-trend"),
    trendSummary: byId("social-radar-trend-summary"),
    trendNote: byId("social-radar-trend-note"),
    coverage: byId("social-radar-coverage"),
    coverageSummary: byId("social-radar-coverage-summary"),
    themes: byId("social-radar-themes"),
    mentions: byId("social-radar-mentions"),
    limitations: byId("social-radar-limitations"),
  };

  const state = {
    snapshot: null,
    history: [],
    file: null,
    pending: null,
    error: "",
    externallyDisabled: false,
  };

  function setStatus(message, tone = "idle") {
    elements.status.textContent = message;
    elements.status.dataset.tone = tone;
  }

  function renderMetrics(snapshot) {
    const metrics = socialRadarMetrics(snapshot);
    const values = [
      ["检索样本", String(metrics.samples), "去重链接"],
      ["样本平台", `${metrics.activePlatforms} / ${metrics.targetPlatforms}`, "本轮找到原帖"],
      ["平台覆盖", `${metrics.checkedPlatforms} / ${metrics.targetPlatforms}`, `${metrics.coveragePercent}% 已核对`],
      ["时间可核验", `${metrics.timestamped} / ${metrics.samples}`, `${metrics.timestampPercent}% 有发布时间`],
      ["独立作者", String(metrics.uniqueAuthors), "仅已识别账号"],
      ["样本倾向", `${metrics.bullish} 多 / ${metrics.bearish} 空`, `${metrics.neutral} 中性 · ${metrics.unclear} 不明`],
    ];
    elements.metrics.replaceChildren();
    for (const [label, value, note] of values) {
      const card = element("article");
      card.append(element("span", "", label), element("strong", "", value), element("small", "", note));
      elements.metrics.append(card);
    }
  }

  function renderTrend(snapshot) {
    const trend = socialRadarTrend([...state.history, snapshot], snapshot);
    const signed = (value) => value == null ? "—" : value > 0 ? `+${value}` : String(value);
    elements.trend.replaceChildren();
    elements.trendSummary.textContent = trend.points.length < 2
      ? `已保存 ${trend.points.length} 次 · 再扫描一次后可比较`
      : `同口径 ${trend.points.length} 次 · 本轮样本 ${signed(trend.sampleDelta)} · 活跃平台 ${signed(trend.platformDelta)} · 已核对 ${signed(trend.coverageDelta)}`;
    const head = element("div", "social-trend-row is-head");
    for (const label of ["扫描时间", "去重样本", "活跃平台", "已核对", "多 / 空", "有时间"]) {
      head.append(element("span", "", label));
    }
    elements.trend.append(head);
    for (const point of [...trend.points].reverse()) {
      const row = element("div", "social-trend-row");
      const metrics = point.metrics;
      for (const value of [
        timeLabel(point.generatedAt),
        String(metrics.samples),
        `${metrics.activePlatforms}/${metrics.targetPlatforms}`,
        `${metrics.checkedPlatforms}/${metrics.targetPlatforms}`,
        `${metrics.bullish}/${metrics.bearish}`,
        `${metrics.timestamped}/${metrics.samples}`,
      ]) row.append(element("span", "", value));
      elements.trend.append(row);
    }
    elements.trendNote.textContent = trend.disclosure;
  }

  function renderCoverage(snapshot) {
    const metrics = socialRadarMetrics(snapshot);
    const counts = new Map();
    for (const mention of snapshot.mentions) counts.set(mention.platform, (counts.get(mention.platform) ?? 0) + 1);
    elements.coverage.replaceChildren();
    elements.coverageSummary.textContent = [
      `${metrics.checkedPlatforms}/${metrics.targetPlatforms} 已核对`,
      `${metrics.sampledPlatforms} 有样本`,
      `${metrics.noResultPlatforms} 无索引结果`,
      `${metrics.blockedPlatforms + metrics.unavailablePlatforms} 受限/不可用`,
      `${metrics.notCheckedPlatforms} 未覆盖`,
    ].join(" · ");
    const byPlatform = new Map(snapshot.coverage.map((item) => [item.platform, item]));
    for (const platform of SOCIAL_PLATFORM_ORDER) {
      const item = byPlatform.get(platform);
      if (!item) continue;
      const card = element("article", "social-coverage-item");
      card.dataset.status = item.status;
      const head = element("div");
      const identity = element("span", "social-coverage-identity");
      identity.append(
        element("i", "", SOCIAL_PLATFORMS[item.platform].mark),
        element("b", "", item.platformLabel),
      );
      head.append(
        identity,
        element("strong", "", item.status === "sampled" ? `${counts.get(item.platform) ?? 0} 条` : coverageLabel(item.status)),
      );
      card.append(head, element("p", "", item.note || coverageLabel(item.status)));
      elements.coverage.append(card);
    }
  }

  function renderThemes(snapshot) {
    elements.themes.replaceChildren();
    for (const theme of snapshot.themes) {
      const item = element("article", "social-theme-item");
      item.dataset.direction = theme.direction;
      item.append(element("b", "", theme.label), element("span", "", theme.summary));
      elements.themes.append(item);
    }
    elements.themes.hidden = snapshot.themes.length === 0;
  }

  function renderMentions(snapshot) {
    elements.mentions.replaceChildren();
    for (const mention of snapshot.mentions) {
      const item = element("article", "social-mention-item");
      const head = element("div");
      const copy = element("div");
      copy.append(
        element("span", "social-mention-platform", mention.platformLabel),
        element("h4", "", mention.title),
      );
      const open = element("button", "ghost-button", "查看原帖");
      open.type = "button";
      open.addEventListener("click", () => {
        void hostCall("external.open", { url: mention.url }).catch((error) => {
          setStatus(error instanceof Error ? error.message : "原帖打开失败", "error");
        });
      });
      head.append(copy, open);
      const meta = [stanceLabel(mention.stance), mention.author, mention.publishedAt ? timeLabel(mention.publishedAt) : "发布时间未核验"]
        .filter(Boolean)
        .join(" · ");
      item.append(head, element("p", "social-mention-meta", meta));
      if (mention.snippet) item.append(element("p", "social-mention-snippet", mention.snippet));
      elements.mentions.append(item);
    }
    if (!snapshot.mentions.length) {
      elements.mentions.append(element("p", "social-radar-empty", "本轮没有可校验的公开原帖链接；这不表示平台没有讨论。"));
    }
  }

  function render() {
    const snapshot = state.snapshot;
    const busy = Boolean(state.pending);
    elements.run.disabled = state.externallyDisabled || busy;
    elements.target.disabled = busy;
    elements.window.disabled = busy;
    elements.run.textContent = busy ? "正在扫描公开样本…" : snapshot ? "更新公开样本" : "扫描公开样本";
    elements.state.dataset.state = busy ? "active" : state.error ? "error" : snapshot ? "ready" : "idle";
    elements.state.textContent = busy
      ? "内置聚合检索中"
      : state.error
        ? "扫描未完成"
        : snapshot
          ? `公开样本 · ${timeLabel(snapshot.generatedAt)}`
          : "内置聚合 · 按需扫描";
    elements.result.hidden = !snapshot;
    if (busy) {
      setStatus("正在分平台检索公开索引；完成后会先校验链接与样本口径，再保存到当前项目。", "active");
    } else if (state.error) {
      setStatus(state.error, "error");
    } else if (!snapshot) {
      setStatus("尚未扫描。不会自动联网，也不会把搜索结果冒充平台全量数据。");
      return;
    } else {
      setStatus(`已保存 ${snapshot.mentions.length} 条去重公开样本；结果只代表 Web Search 可检索范围。`);
    }
    if (!snapshot) return;
    elements.title.textContent = `${snapshot.resolved.name}${snapshot.resolved.symbol ? ` · ${snapshot.resolved.symbol}` : ""}`;
    elements.meta.textContent = `${windowLabel(snapshot.windowHours)} · 生成于 ${timeLabel(snapshot.generatedAt)}`;
    elements.summary.textContent = snapshot.summary;
    renderMetrics(snapshot);
    renderTrend(snapshot);
    renderCoverage(snapshot);
    renderThemes(snapshot);
    renderMentions(snapshot);
    elements.limitations.replaceChildren();
    for (const limitation of snapshot.limitations) elements.limitations.append(element("li", "", limitation));
  }

  async function read() {
    const epoch = currentEpoch();
    try {
      const file = await hostCall("workspace.readText", { path: SOCIAL_RADAR_PATH });
      if (epoch !== currentEpoch()) return null;
      state.file = {
        exists: true,
        modifiedAt: file.modifiedAt,
        revision: file.revision,
      };
      state.snapshot = parseSocialRadarSnapshot(file.content);
      state.error = "";
    } catch (error) {
      if (epoch !== currentEpoch()) return null;
      const message = error instanceof Error ? error.message : "";
      if (/not found|ENOENT|不存在|没有(?:这个|该)?.{0,12}文件|missing/iu.test(message)) {
        state.file = { exists: false };
        state.snapshot = null;
        state.error = "";
      } else {
        state.snapshot = null;
        state.error = `已保存的公开社媒结果不可读：${message || "校验失败"}`;
      }
    }
    if (state.snapshot) await readHistory(state.snapshot, epoch);
    render();
    return state.snapshot;
  }

  async function readHistory(current, epoch = currentEpoch()) {
    const snapshots = [current];
    try {
      const listing = await hostCall("workspace.list", { path: SOCIAL_RADAR_HISTORY_DIRECTORY, depth: 1, limit: 50 });
      const entries = Array.isArray(listing?.entries)
        ? listing.entries
          .filter((entry) => entry?.kind === "file" && typeof entry.path === "string" && entry.path.startsWith(`${SOCIAL_RADAR_HISTORY_DIRECTORY}/`) && entry.path.endsWith(".json"))
          .sort((left, right) => String(right.modifiedAt ?? "").localeCompare(String(left.modifiedAt ?? "")))
          .slice(0, 12)
        : [];
      for (const entry of entries) {
        if (epoch !== currentEpoch()) return;
        try {
          const file = await hostCall("workspace.readText", { path: entry.path });
          snapshots.push(parseSocialRadarSnapshot(file.content));
        } catch {
          // A damaged archive must not hide the latest validated snapshot.
        }
      }
    } catch {
      // Older hosts may not list an empty directory yet; keep the current item.
    }
    if (epoch === currentEpoch()) state.history = snapshots;
  }

  async function write(content, epoch) {
    if (epoch !== currentEpoch()) throw new Error("工作区已切换；旧扫描结果不会写入当前项目");
    const result = await hostCall("workspace.writeText", {
      path: SOCIAL_RADAR_PATH,
      content,
      ...expectedWriteParams(state.file),
    });
    if (epoch !== currentEpoch()) throw new Error("工作区已切换；旧扫描结果不会写入当前项目");
    const reread = await hostCall("workspace.readText", { path: SOCIAL_RADAR_PATH });
    const snapshot = parseSocialRadarSnapshot(reread.content);
    const archivePath = socialRadarArchivePath(snapshot);
    let archiveExpected = { expectedModifiedAt: null };
    try {
      archiveExpected = expectedWriteParams(await hostCall("workspace.readText", { path: archivePath }));
    } catch {
      // This scan timestamp has not been archived yet.
    }
    await hostCall("workspace.writeText", { path: archivePath, content, ...archiveExpected });
    state.file = {
      exists: true,
      modifiedAt: reread.modifiedAt ?? result.modifiedAt,
      revision: reread.revision ?? result.revision,
    };
    await readHistory(snapshot, epoch);
    return snapshot;
  }

  async function handleTaskChanged(agentTask) {
    const pending = state.pending;
    if (!pending || agentTask?.id !== pending.id) return;
    if (["queued", "running", "cancelling"].includes(agentTask.status)) {
      render();
      return;
    }
    const error = taskError(agentTask);
    if (agentTask.status !== "completed" || error) {
      state.pending = null;
      state.error = error || "公开社媒扫描未完成";
      onBusyChange(false);
      render();
      notify(state.error, "error");
      return;
    }
    if (pending.finalizing) return;
    pending.finalizing = true;
    try {
      const content = normalizeSocialRadarTaskResult(agentTask.result?.text, pending.spec);
      const snapshot = await write(content, pending.epoch);
      if (state.pending !== pending || pending.epoch !== currentEpoch()) return;
      state.snapshot = snapshot;
      state.pending = null;
      state.error = "";
      onBusyChange(false);
      elements.target.value = `${snapshot.resolved.symbol} ${snapshot.resolved.name}`.trim();
      render();
      notify(`公开社媒样本已保存到 ${SOCIAL_RADAR_PATH}`);
      elements.result.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (caught) {
      if (state.pending !== pending || pending.epoch !== currentEpoch()) return;
      state.pending = null;
      state.error = caught instanceof Error ? caught.message : "公开社媒扫描结果保存失败";
      onBusyChange(false);
      render();
      notify(state.error, "error");
    }
  }

  async function run() {
    if (state.pending || state.externallyDisabled) return;
    let spec;
    try {
      spec = buildSocialRadarTask(elements.target.value, Number(elements.window.value), now());
    } catch (error) {
      state.error = error instanceof Error ? error.message : "社媒扫描输入无效";
      render();
      return;
    }
    const epoch = currentEpoch();
    state.error = "";
    try {
      const task = await hostCall("agent.task.start", {
        prompt: `先使用 Skill 工具加载 ${INVESTMENT_RESEARCH_SKILL}，再执行以下任务。\n\n${spec.prompt}`,
        label: spec.displayText,
        skill: INVESTMENT_RESEARCH_SKILL,
        toolNames: ["WebSearch", "WebFetch"],
        maxTurns: 10,
        maxContextTokens: 24_576,
      });
      if (epoch !== currentEpoch()) return;
      if (typeof task?.id !== "string") throw new Error("无法创建公开社媒扫描任务");
      state.pending = { id: task.id, epoch, finalizing: false, spec };
      onBusyChange(true);
      render();
      notify("已开始按平台检索公开社媒样本");
      const latest = await hostCall("agent.task.get", { id: task.id }).catch(() => task);
      void handleTaskChanged(latest);
    } catch (error) {
      state.error = error instanceof Error ? error.message : "公开社媒扫描提交失败";
      render();
      notify(state.error, "error");
    }
  }

  const unsubscribe = onHostEvent?.("agent.task.changed", (task) => void handleTaskChanged(task));
  elements.run.addEventListener("click", () => void run());
  elements.target.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void run();
  });
  render();

  return {
    load: read,
    run,
    state,
    setDisabled(disabled) {
      state.externallyDisabled = Boolean(disabled);
      render();
    },
    reset() {
      state.snapshot = null;
      state.history = [];
      state.file = null;
      state.pending = null;
      state.error = "";
      elements.target.value = "";
      elements.window.value = "168";
      render();
    },
    dispose() {
      if (typeof unsubscribe === "function") unsubscribe();
    },
  };
}
