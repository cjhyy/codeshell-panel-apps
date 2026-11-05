import { normalizeVideoSearchUrl } from "./video-search.js";

const TASK_METHODS = [
  "agent.task.models",
  "agent.task.start",
  "agent.task.get",
  "agent.task.cancel",
];
const PROCESS_METHODS = ["process.find", "process.spawn", "process.get", "process.cancel"];
const NODE_METHODS = ["process.resolveEntry", "process.write", "process.end"];
const COOKIE_METHODS = ["credentials.cookies.listForTask", "credentials.cookies.authorizeProcess"];
// www also matches saved root-domain accounts; a bare host cannot match a www-only login.
const PLATFORM_URLS = {
  youtube: "https://www.youtube.com/",
  bilibili: "https://www.bilibili.com/",
};
const PLATFORM_NAMES = { youtube: "YouTube", bilibili: "B 站" };

function supportsSearchAccounts(context) {
  return (
    context.capabilities?.tasks?.cookieCredentials === true &&
    context.capabilities?.process?.cookieCredentials === true &&
    COOKIE_METHODS.every((method) => context.availableMethods?.includes(method))
  );
}

/** Only non-secret account metadata crosses into the search UI. Never select an account by default. */
export async function listVideoSearchAccounts({ context, panel, platform }) {
  if (!PLATFORM_URLS[platform]) throw new Error("未知的视频平台。");
  if (!panel || !supportsSearchAccounts(context)) return { supported: false, accounts: [] };
  const result = await panel.call("credentials.cookies.listForTask", {
    url: PLATFORM_URLS[platform],
  });
  if (!Array.isArray(result?.accounts)) throw new Error("账号列表暂不可用，请刷新后重试。");
  return {
    supported: true,
    accounts: result.accounts
      .filter(
        (account) =>
          typeof account?.id === "string" &&
          account.id &&
          account.id.length <= 256 &&
          /^[a-f0-9]{64}$/.test(account.revision || "") &&
          account.health !== "corrupted",
      )
      .map(({ id, revision, label }) => ({
        id,
        revision,
        label: typeof label === "string" ? label.slice(0, 160) : "已保存账号",
      })),
  };
}

function checkAbort(signal) {
  if (signal?.aborted) throw new Error("已取消");
}

// yt-dlp's flat Bilibili search returns legacy HTTP /video/ URLs without titles.
// Only this process-result adapter may upgrade them; public/AI URLs stay HTTPS-only.
function ytDlpSearchTarget(value, platform) {
  const target = normalizeVideoSearchUrl(value);
  if (target) return target.platform === platform ? target : null;
  if (
    platform !== "bilibili" ||
    typeof value !== "string" ||
    value.length > 4096 ||
    /[\u0000-\u0020\u007f\\]/.test(value)
  )
    return null;
  const authority = value.match(/^http:\/\/([^/?#]+)\//i)?.[1]?.toLowerCase();
  if (!["bilibili.com", "www.bilibili.com", "m.bilibili.com"].includes(authority)) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" || parsed.username || parsed.password || parsed.port) return null;
  const rawPath = value.match(/^http:\/\/[^/?#]+(\/[^?#]*)/i)?.[1];
  if (parsed.pathname !== rawPath) return null;
  const id = parsed.pathname.match(/^\/video\/(BV[A-Za-z0-9]{10}|av\d+)\/?$/)?.[1];
  return id ? normalizeVideoSearchUrl(`https://www.bilibili.com/video/${id}/`) : null;
}

/** Discover read-only search sources before spending a model request. No process is started. */
export async function prepareVideoSearchSource({
  context,
  runtime,
  panel,
  auxiliary,
  signal,
  platforms = ["youtube", "bilibili"],
  accounts = {},
}) {
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
  if (!accounts || typeof accounts !== "object" || Array.isArray(accounts))
    throw new Error("查询账号选择无效，请重新选择。");
  // Snapshot before discovery/confirmation awaits. A refresh must never switch the query's account.
  const selectedAccounts = Object.fromEntries(
    Object.entries(accounts).map(([platform, account]) => {
      if (
        !PLATFORM_URLS[platform] ||
        !platforms.includes(platform) ||
        typeof account?.id !== "string" ||
        !account.id ||
        account.id.length > 256 ||
        !/^[a-f0-9]{64}$/.test(account.revision || "")
      )
        throw new Error("查询账号选择无效，请重新选择。");
      return [platform, { id: account.id, revision: account.revision }];
    }),
  );
  if (Object.keys(selectedAccounts).length && !supportsSearchAccounts(context))
    throw new Error("当前 Host 不支持带账号查询，请更新 Host；也可以明确选择匿名查询。");
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
  if (ytDlp) ytDlp = { ...ytDlp };
  const localAvailable = Boolean(ytDlp?.handle) && ytDlp.verified !== false;
  if (Object.keys(selectedAccounts).length && !localAvailable)
    throw new Error("带账号查询需要可用的 yt-dlp；不会自动改为匿名检索。");
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
  const fileArgumentHandles = {};
  for (const [platform, selected] of Object.entries(selectedAccounts)) {
    checkAbort(signal);
    const current = await listVideoSearchAccounts({ context, panel, platform });
    checkAbort(signal);
    if (
      !current.accounts.some(
        (account) => account.id === selected.id && account.revision === selected.revision,
      )
    )
      throw new Error(
        `${PLATFORM_NAMES[platform]}账号已变化或不可用，请先刷新并重新选择；若登录失效，请重新登录后保存。`,
      );
    const result = await panel.call("credentials.cookies.authorizeProcess", {
      credentialId: selected.id,
      revision: selected.revision,
      url: PLATFORM_URLS[platform],
      executableHandle: ytDlp.handle,
    });
    checkAbort(signal);
    if (
      !result?.authorized ||
      typeof result.fileArgumentHandle !== "string" ||
      !result.fileArgumentHandle
    )
      throw new Error(
        result?.invalid
          ? `${PLATFORM_NAMES[platform]}登录态已失效，请重新登录并刷新账号。`
          : `未获准使用${PLATFORM_NAMES[platform]}账号，查询已停止；不会改为匿名检索。`,
      );
    fileArgumentHandles[platform] = [result.fileArgumentHandle];
  }
  return {
    directory,
    ytDlp: localAvailable ? { ...ytDlp } : null,
    nodeAvailable,
    fileArgumentHandles,
  };
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
      ...(runtime.fileArgumentHandles?.[platform]?.length
        ? { fileArgumentHandles: runtime.fileArgumentHandles[platform] }
        : {}),
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
      const rawUrl =
        row.webpage_url ||
        row.url ||
        (platform === "youtube" && row.id ? `https://www.youtube.com/watch?v=${row.id}` : "");
      const target = ytDlpSearchTarget(rawUrl, platform);
      if (!target) return null;
      const url = target.url;
      if (!row.title && platform === "bilibili") {
        try {
          const detail = await auxiliary.run({
            executableHandle: runtime.ytDlp.handle,
            directoryHandle: runtime.directory.handle,
            ...(runtime.fileArgumentHandles?.[platform]?.length
              ? { fileArgumentHandles: runtime.fileArgumentHandles[platform] }
              : {}),
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
          if (detail.code !== 0)
            throw new Error(formatError(detail.stderr, "视频信息读取", detail.code));
          metadata = JSON.parse(detail.stdout);
        } catch (error) {
          if (signal?.aborted) throw new Error("已取消");
          if (runtime.fileArgumentHandles?.[platform]?.length) throw error;
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
    const authenticated = Boolean(runtime.fileArgumentHandles?.[platform]?.length);
    const attempts = (
      authenticated
        ? [localSearch]
        : platform === "youtube"
          ? [alternativeSearch, localSearch]
          : [localSearch, alternativeSearch]
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
      warnings.push(
        `${platform === "youtube" ? "YouTube" : "B站"}：${errors.join("；")}${
          authenticated
            ? "；使用所选账号的查询失败，请检查登录态或站点访问限制。未改为匿名检索。"
            : ""
        }`,
      );
  }
  return { candidates, warnings: [...new Set(warnings)] };
}
