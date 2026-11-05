import { normalizeVideoSearchUrl } from "./video-search.js";

const TASK_METHODS = [
  "agent.task.models",
  "agent.task.start",
  "agent.task.get",
  "agent.task.cancel",
];
const PROCESS_METHODS = ["process.find", "process.spawn", "process.get", "process.cancel"];
const NODE_METHODS = ["process.resolveEntry", "process.write", "process.end"];

function checkAbort(signal) {
  if (signal?.aborted) throw new Error("已取消");
}

/** Discover read-only search sources before spending a model request. No process is started. */
export async function prepareVideoSearchSource({ context, runtime, panel, auxiliary, signal }) {
  checkAbort(signal);
  if (!panel) throw new Error("请在 CodeShell 中使用平台实时搜索。");
  if (!Array.isArray(context.availableMethods))
    throw new Error("当前宿主未提供查询能力清单，请更新 CodeShell 后重试。");
  const methods = new Set(context.availableMethods);
  const missing = [...TASK_METHODS, ...PROCESS_METHODS].filter((method) => !methods.has(method));
  if (missing.length) throw new Error(`当前宿主缺少查询能力：${missing.join("、")}。`);
  if (!runtime.directory?.handle) throw new Error("请先在下载页选择可用的项目目录，再查询视频。");
  auxiliary.assertAvailable?.();
  const directory = { ...runtime.directory };
  const errors = [];
  let ytDlp = runtime.ytDlp;
  if (!ytDlp) {
    try {
      const found = await panel.call("process.find", { name: "yt-dlp" });
      ytDlp = found?.available ? found : null;
    } catch (error) {
      errors.push(`yt-dlp：${error.message || String(error)}`);
    }
  }
  checkAbort(signal);
  const localAvailable = Boolean(ytDlp?.handle) && ytDlp.verified !== false;
  let nodeAvailable = false;
  if (NODE_METHODS.every((method) => methods.has(method))) {
    try {
      await auxiliary.prepareSearch();
      nodeAvailable = true;
    } catch (error) {
      errors.push(`Node 检索工具：${error.message || String(error)}`);
    }
  } else
    errors.push(
      `Node 检索缺少 ${NODE_METHODS.filter((method) => !methods.has(method)).join("、")}`,
    );
  checkAbort(signal);
  if (!localAvailable && !nodeAvailable)
    throw new Error(
      `没有可用的检索工具：yt-dlp 不可用，Node 备用检索也不可用。${errors.join("；")}`,
    );
  return { directory, ytDlp: localAvailable ? { ...ytDlp } : null, nodeAvailable };
}

export async function searchVideoPlatforms(
  { query, platforms, limit = 8, signal },
  prepared,
  auxiliary,
  formatError = (_stderr, operation, code) => `${operation}未完成（退出码 ${code ?? "未知"}）。`,
) {
  const runtime = prepared;
  if (!runtime?.directory?.handle) throw new Error("查询目录已不可用，请重新查询。");
  const candidates = [],
    warnings = [];
  const count = Math.max(1, Math.min(8, Number(limit) || 8));
  async function localSearch(platform) {
    const prefix = platform === "youtube" ? "ytsearch" : "bilisearch";
    const result = await auxiliary.run({
      executableHandle: runtime.ytDlp.handle,
      directoryHandle: runtime.directory.handle,
      args: [
        "--ignore-config",
        "--no-cache-dir",
        "--skip-download",
        "--flat-playlist",
        "--dump-single-json",
        "--socket-timeout",
        "10",
        "--retries",
        "0",
        "--extractor-retries",
        "0",
        "--",
        `${prefix}${count}:${String(query).slice(0, 300)}`,
      ],
      signal,
      timeout: 25_000,
    });
    if (result.code !== 0) throw new Error(formatError(result.stderr, "平台检索", result.code));
    const raw = JSON.parse(result.stdout);
    const rows = Array.isArray(raw.entries) ? raw.entries.slice(0, count) : [];
    async function resolveRow(row) {
      if (signal?.aborted) throw new Error("已取消");
      if (!row) return null;
      let metadata = row;
      const url =
        row.webpage_url ||
        row.url ||
        (platform === "youtube" && row.id ? `https://www.youtube.com/watch?v=${row.id}` : "");
      if (normalizeVideoSearchUrl(url)?.platform !== platform) return null;
      if (!row.title && platform === "bilibili") {
        try {
          const detail = await auxiliary.run({
            executableHandle: runtime.ytDlp.handle,
            directoryHandle: runtime.directory.handle,
            args: [
              "--ignore-config",
              "--no-cache-dir",
              "--skip-download",
              "--no-playlist",
              "--dump-single-json",
              "--socket-timeout",
              "8",
              "--retries",
              "0",
              "--extractor-retries",
              "0",
              "--",
              url,
            ],
            signal,
            timeout: 12_000,
          });
          if (detail.code !== 0) return null;
          metadata = JSON.parse(detail.stdout);
        } catch (error) {
          if (signal?.aborted) throw new Error("已取消");
          return null;
        }
      }
      return metadata.title
        ? {
            title: metadata.title,
            url,
            platform,
            author: metadata.uploader || metadata.channel || "",
            duration: metadata.duration,
            evidence: "platform-search",
          }
        : null;
    }
    const found = [];
    for (let index = 0; index < rows.length; index += 2) {
      const batch = await Promise.all(rows.slice(index, index + 2).map(resolveRow));
      found.push(...batch.filter(Boolean));
    }
    return found;
  }
  async function alternativeSearch(platform) {
    const result = await auxiliary.search(
      runtime.directory,
      platform,
      String(query).slice(0, 300),
      count,
      signal,
    );
    if (result.candidates.length && result.source === "search-index")
      warnings.push(
        `${platform === "youtube" ? "YouTube" : "B站"}直连暂不可用；以下链接来自公开搜索索引，页面是否仍可访问请打开原始页面确认。`,
      );
    return result.candidates;
  }
  for (const platform of platforms) {
    if (signal?.aborted) throw new Error("已取消");
    if (!["youtube", "bilibili"].includes(platform)) continue;
    const errors = [];
    const attempts = (
      platform === "youtube" ? [alternativeSearch, localSearch] : [localSearch, alternativeSearch]
    ).filter((attempt) =>
      attempt === localSearch ? Boolean(runtime.ytDlp?.handle) : runtime.nodeAvailable,
    );
    if (!attempts.length) throw new Error("没有可用的检索工具，请重新检查查询环境。");
    let found = [];
    for (const attempt of attempts) {
      if (signal?.aborted) throw new Error("已取消");
      try {
        found = await attempt(platform);
        if (found.length) break;
      } catch (error) {
        if (signal?.aborted) throw new Error("已取消");
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    candidates.push(...found);
    if (!found.length && errors.length)
      warnings.push(`${platform === "youtube" ? "YouTube" : "B站"}：${errors.join("；")}`);
  }
  return { candidates, warnings: [...new Set(warnings)] };
}
