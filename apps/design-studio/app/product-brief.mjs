/* Markdown PRD parsing for the Design Studio product-delivery workflow. */

const SECTION_ALIASES = new Map([
  ["goals", ["目标", "目的", "goals", "objectives"]],
  ["audience", ["用户", "受众", "人群", "audience", "users", "personas"]],
  ["requirements", ["需求", "功能", "范围", "requirements", "features", "scope"]],
  ["screens", ["页面", "界面", "路由", "screens", "pages", "routes", "flows"]],
  ["acceptance", ["验收", "成功标准", "acceptance", "success metrics", "definition of done"]],
  ["constraints", ["约束", "限制", "非目标", "constraints", "non-goals", "out of scope"]],
]);

function cleanInline(value) {
  return String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 600);
}

function slug(value, fallback) {
  const normalized = cleanInline(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 56);
  return /^[a-z]/u.test(normalized) ? normalized : fallback;
}

function sectionKind(heading) {
  const normalized = cleanInline(heading).toLowerCase();
  for (const [kind, aliases] of SECTION_ALIASES) {
    if (aliases.some((alias) => normalized.includes(alias))) return kind;
  }
  return "other";
}

function itemText(line) {
  return cleanInline(
    line
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/u, "")
      .replace(/^\s*[-*]\s*\[[ xX]\]\s*/u, ""),
  );
}

function priorityFromText(value) {
  const match = value.match(/\b(P[0-3])\b/iu);
  if (match) return match[1].toUpperCase();
  if (/(必须|核心|critical|must have)/iu.test(value)) return "P0";
  if (/(应该|重要|should have)/iu.test(value)) return "P1";
  if (/(可选|以后|nice to have|optional)/iu.test(value)) return "P2";
  return "P1";
}

function requirementRecord(text, index) {
  const acceptanceParts = text.split(/\s+(?:验收|acceptance)\s*[:：]\s*/iu);
  const statement = cleanInline(acceptanceParts.shift());
  return {
    id: `req-${String(index + 1).padStart(2, "0")}-${slug(statement, "item").slice(0, 36)}`,
    priority: priorityFromText(statement),
    statement: statement.replace(/^\[?P[0-3]\]?\s*[:：-]?\s*/iu, ""),
    acceptanceCriteria: acceptanceParts.map(cleanInline).filter(Boolean),
  };
}

function screenRecord(text, index) {
  const [name, ...description] = text.split(/\s*[:：]\s*/u);
  return {
    id: `screen-${String(index + 1).padStart(2, "0")}-${slug(name, "page").slice(0, 32)}`,
    name: cleanInline(name),
    description: cleanInline(description.join("：")),
  };
}

export function isSafeProductBriefPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes(":") &&
    !value.includes("?") &&
    !value.includes("#") &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    /\.(?:md|mdx|txt)$/iu.test(value) &&
    value.split("/").every((part) => part && part !== "." && part !== ".." && !part.startsWith("."))
  );
}

export function parseProductBrief(markdown, { path = "PRD.md" } = {}) {
  if (typeof markdown !== "string" || !markdown.trim()) {
    throw new Error("PRD 内容为空");
  }
  if (new TextEncoder().encode(markdown).length > 512 * 1024) {
    throw new Error("PRD 超过 512 KiB 读取上限");
  }
  const sections = [];
  let current = { level: 0, heading: "概要", kind: "other", lines: [] };
  sections.push(current);
  let title = "";
  for (const rawLine of markdown.replaceAll("\r\n", "\n").split("\n")) {
    const heading = rawLine.match(/^(#{1,4})\s+(.+?)\s*$/u);
    if (heading) {
      const headingText = cleanInline(heading[2]);
      if (!title && heading[1].length === 1) title = headingText;
      current = {
        level: heading[1].length,
        heading: headingText,
        kind: sectionKind(headingText),
        lines: [],
      };
      sections.push(current);
      continue;
    }
    if (rawLine.trim()) current.lines.push(rawLine);
  }
  const itemsFor = (kind) =>
    sections
      .filter((section) => section.kind === kind)
      .flatMap((section) =>
        section.lines
          .filter((line) => /^\s*(?:[-*+]|\d+[.)])\s+/u.test(line))
          .map(itemText)
          .filter(Boolean),
      );
  const proseFor = (kind) =>
    sections
      .filter((section) => section.kind === kind)
      .flatMap((section) => section.lines)
      .filter((line) => !/^\s*(?:[-*+]|\d+[.)])\s+/u.test(line))
      .map(cleanInline)
      .filter(Boolean);
  const requirements = itemsFor("requirements").map(requirementRecord);
  const acceptance = itemsFor("acceptance");
  if (requirements.length === 0) {
    const fallbackItems = sections
      .flatMap((section) => section.lines)
      .filter((line) => /^\s*(?:[-*+]|\d+[.)])\s+/u.test(line))
      .map(itemText)
      .filter(Boolean);
    requirements.push(...fallbackItems.slice(0, 50).map(requirementRecord));
  }
  const screens = itemsFor("screens").map(screenRecord);
  return {
    format: "codeshell.product-brief",
    version: 1,
    path,
    title: title || path.split("/").at(-1)?.replace(/\.[^.]+$/u, "") || "Product brief",
    summary: sections[0].lines.map(cleanInline).filter(Boolean).join(" ").slice(0, 2000),
    goals: [...proseFor("goals"), ...itemsFor("goals")].slice(0, 30),
    audience: [...proseFor("audience"), ...itemsFor("audience")].slice(0, 30),
    requirements: requirements.slice(0, 100),
    screens: screens.slice(0, 50),
    acceptanceCriteria: [...proseFor("acceptance"), ...acceptance].slice(0, 50),
    constraints: [...proseFor("constraints"), ...itemsFor("constraints")].slice(0, 50),
    sourceSectionCount: sections.length - 1,
  };
}

export function productBriefPrompt(brief, { designPath }) {
  const list = (values, limit = 30) =>
    values.length
      ? values
          .slice(0, limit)
          .map((value) => `- ${String(value).slice(0, 240)}`)
          .join("\n")
      : "- 未明确";
  return [
    "请使用 design-studio:repo-design skill，把以下结构化 PRD 转成可交付的 Design v3 设计。",
    `设计源文件：${designPath}`,
    `PRD：${brief.path}`,
    "",
    `产品：${brief.title}`,
    brief.summary ? `摘要：${brief.summary}` : "",
    "",
    "目标",
    list(brief.goals),
    "",
    "目标用户",
    list(brief.audience),
    "",
    "页面 / 流程",
    list(brief.screens.map((screen) => `${screen.name}${screen.description ? `：${screen.description}` : ""}`)),
    "",
    "需求（保留这些 ID 到图层 notes，便于交付追踪）",
    list(
      brief.requirements.map(
        (requirement) =>
          `${requirement.id} [${requirement.priority}] ${requirement.statement}${
            requirement.acceptanceCriteria.length
              ? `；验收：${requirement.acceptanceCriteria.join("；")}`
              : ""
          }`,
      ),
      80,
    ),
    "",
    "全局验收",
    list(brief.acceptanceCriteria),
    "",
    "约束",
    list(brief.constraints),
    "",
    "先读取设计元数据与现有组件，规划页面和组件复用；优先使用 Auto Layout、Wrap、Grid 和双轴 Hug/Fill/Fixed。完成后必须 validate_design、检查全页截图，再生成前端并与设计同视口比较。不要用大批绝对坐标模拟正常网页布局。",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
