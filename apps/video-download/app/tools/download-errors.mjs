// Only fixed, reviewed diagnostics may leave the downloader process boundary.
// Never return an upstream line: it may contain credentials or signed media URLs.
export function classifyYtDlpFailure(output) {
  const lines = String(output || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .toLowerCase()
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:warning:|\[debug\])/u.test(line));
  const errors = lines.filter((line) => /^\s*error:/u.test(line));
  const text = (errors.length ? errors : lines).join("\n");
  const httpStatus = (status, phrase) =>
    new RegExp(
      `\\b(?:http(?:\\s*error)?|status(?:\\s+code)?)\\s*[:=]?\\s*${status}\\b|\\b${status}\\s+${phrase}\\b`,
    ).test(text);
  if (httpStatus(412, "precondition failed")) {
    return {
      code: "SOURCE_HTTP_412",
      message:
        "站点拒绝了当前请求（HTTP 412），可能需要验证或访问受限。请先在浏览器确认视频可播放；需要登录时，在“更多选项 → 登录账号”中登录并保存，再选择账号重试。若仍失败，请稍后再试。",
      retryable: true,
    };
  }
  if (httpStatus(429, "too many requests")) {
    return {
      code: "SOURCE_HTTP_429",
      message: "站点请求过于频繁（HTTP 429）。请暂停请求，稍后再试，避免连续重试。",
      retryable: true,
    };
  }
  if (
    /\bsign[ -]?in\b|\blog[ -]?in required\b|please log[ -]?in\b|confirm you[’']re not a bot|requires? (?:cookie|account) verification|cookies? (?:are )?required/i.test(
      text,
    )
  ) {
    return {
      code: "SOURCE_LOGIN_REQUIRED",
      message:
        "站点要求登录或账号验证。请先在浏览器确认视频可访问，再在“更多选项 → 登录账号”中登录并保存，选择有权访问的账号重试。",
      retryable: true,
    };
  }
  return null;
}
