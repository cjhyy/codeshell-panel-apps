import {
  DATA_SOURCE_CATALOG,
  DATA_SOURCE_CAPABILITIES,
  parseDataSourceConfig,
  STANDARD_INDUSTRY_EXAMPLE,
} from "../data-source-config.mjs";

export function createDataSourcesController({
  hostCall,
  storageKey,
  currentEpoch,
  onApply,
  onHistory,
}) {
  const el = (id) => document.getElementById(id);
  let config = parseDataSourceConfig(),
    ready = false;
  const dialog = el("data-sources-dialog");
  function render() {
    el("sources-industry").value = config.industry;
    el("sources-label").value = config.label;
    el("sources-endpoint").value = config.endpoint;
    el("sources-custom").hidden = config.industry !== "standard-json";
    el("sources-catalog").replaceChildren(
      ...DATA_SOURCE_CATALOG.map((source) => {
        const card = document.createElement("article");
        const title = document.createElement("h3");
        title.textContent = source.label;
        const capabilities = document.createElement("p");
        capabilities.textContent = source.capabilities
          .map((key) => DATA_SOURCE_CAPABILITIES[key] ?? key)
          .join(" · ");
        const note = document.createElement("small");
        note.textContent = [source.access, source.taxonomy].filter(Boolean).join(" · ");
        card.append(title, capabilities, note);
        return card;
      }),
    );
    el("sources-save").disabled = !ready;
  }
  el("data-sources-open").addEventListener("click", () => {
    render();
    dialog.showModal();
  });
  el("sources-close").addEventListener("click", () => dialog.close());
  el("sources-history").addEventListener("click", () => {
    dialog.close();
    onHistory();
  });
  el("sources-industry").addEventListener("change", () => {
    el("sources-custom").hidden = el("sources-industry").value !== "standard-json";
  });
  el("sources-example").textContent = JSON.stringify(STANDARD_INDUSTRY_EXAMPLE, null, 2);
  el("sources-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const epoch = currentEpoch();
    try {
      const next = parseDataSourceConfig({
        industry: el("sources-industry").value,
        label: el("sources-label").value,
        endpoint: el("sources-endpoint").value,
      });
      el("sources-save").disabled = true;
      await hostCall("storage.set", { key: storageKey(), value: next });
      if (epoch !== currentEpoch()) return;
      config = next;
      el("sources-state").textContent =
        "配置已保存。正在读取该来源的选股数据，连接结果会显示在下方。";
      const snapshot = await onApply();
      if (epoch === currentEpoch())
        el("sources-state").textContent = snapshot
          ? "配置已应用。以下显示本次取得的数据和仍未恢复的来源。"
          : "配置已保存；本次选股读取未完成，请查看选股页的具体错误后重试。";
    } catch (error) {
      if (epoch === currentEpoch())
        el("sources-state").textContent =
          error instanceof Error ? error.message : "保存失败，请重试";
    } finally {
      if (epoch === currentEpoch()) el("sources-save").disabled = !ready;
    }
  });
  render();
  return {
    get config() {
      return config;
    },
    async load() {
      const epoch = currentEpoch();
      ready = false;
      try {
        const value = await hostCall("storage.get", { key: storageKey() });
        if (epoch !== currentEpoch()) return;
        config = parseDataSourceConfig(value ?? {});
        ready = true;
        el("sources-state").textContent =
          "自动模式优先新浪，受限时尝试东方财富。行业分类、成分和重试记录按来源隔离。";
      } catch (error) {
        if (epoch !== currentEpoch()) return;
        config = parseDataSourceConfig();
        el("sources-state").textContent =
          `配置读取失败：${error.message}。本次使用默认来源，未覆盖已保存配置。`;
      }
      render();
    },
    update(snapshot) {
      if (!snapshot) {
        el("sources-health").textContent = "尚未取得连接结果";
        return;
      }
      const provider = snapshot.industryProvider;
      const errors = snapshot.sourceErrors ?? [];
      el("sources-health").textContent = [
        `当前行业口径：${provider?.label ?? "新浪行业"}${provider?.fallback ? " · 已切换备用源" : ""}`,
        `行情时点 ${snapshot.asOf} · 行业 ${snapshot.sectorDirectory?.length ?? 0} 个`,
        snapshot.sourceStatus.industries
          ? "行业目录已取得"
          : "行业目录尚未完整取得，保留已核验数据",
        snapshot.scanProgress
          ? `行业分析进度：${snapshot.scanProgress.completedSectors}/${snapshot.scanProgress.totalSectors}；待处理 ${snapshot.scanProgress.pendingSectors}；失败 ${snapshot.scanProgress.failedSectors}`
          : "成分与分析进度请查看选股页",
        ...errors
          .filter((error) => /industr|sector/.test(error.source))
          .slice(0, 5)
          .map((error) => `${error.source}：${error.errorCode} · ${error.message}`),
      ].join("\n");
    },
  };
}
