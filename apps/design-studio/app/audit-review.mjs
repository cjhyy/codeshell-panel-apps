/* Bounded, deterministic review views over the complete audit result. */
const SEVERITIES = new Set(["all", "blocking", "warning", "error"]);

function assertIssues(issues) {
  if (!Array.isArray(issues)) throw new TypeError("审计问题必须是数组");
  for (const issue of issues) {
    if (
      !issue ||
      typeof issue !== "object" ||
      Array.isArray(issue) ||
      typeof issue.code !== "string" ||
      !issue.code ||
      !["error", "warning"].includes(issue.severity) ||
      (issue.blocking !== undefined && typeof issue.blocking !== "boolean")
    ) {
      throw new TypeError("审计问题需要 code、error/warning 严重度和可选 blocking 布尔值");
    }
  }
}

function isBlocking(issue) {
  return issue.blocking === true || issue.severity === "error";
}

export function groupAuditIssues(issues) {
  assertIssues(issues);
  const groups = new Map();
  for (const issue of issues) {
    let group = groups.get(issue.code);
    if (!group) {
      group = { code: issue.code, count: 0, blocking: 0, error: 0, warning: 0, examples: [] };
      groups.set(issue.code, group);
    }
    group.count += 1;
    if (isBlocking(issue)) group.blocking += 1;
    group[issue.severity] += 1;
    if (group.examples.length < 3) group.examples.push(issue);
  }
  return [...groups.values()];
}

// Omit code, or pass an empty string, to include every issue code.
export function pageAuditIssues(issues, options = {}) {
  assertIssues(issues);
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new TypeError("审计分页参数必须是对象");
  const { code, severity = "all", offset = 0, limit = 50 } = options;
  if (code !== undefined && typeof code !== "string") throw new TypeError("code 必须是字符串");
  if (!SEVERITIES.has(severity)) throw new TypeError("severity 必须是 all/blocking/warning/error");
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError("offset 必须是非负整数");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 400)
    throw new RangeError("limit 必须是 1–400 的整数");
  const filtered = issues.filter(
    (issue) =>
      (!code || issue.code === code) &&
      (severity === "all" || (severity === "blocking" ? isBlocking(issue) : issue.severity === severity)),
  );
  const page = filtered.slice(offset, offset + limit);
  return {
    issues: page,
    total: filtered.length,
    offset,
    limit,
    nextOffset: offset < filtered.length - page.length ? offset + page.length : null,
  };
}
