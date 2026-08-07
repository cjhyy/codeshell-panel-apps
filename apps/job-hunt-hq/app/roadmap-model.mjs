export const PREPARATION_GAP_KIND_IDS = ["profile", "evidence", "skill"];

export const PREPARATION_GAP_KIND_LABELS = {
  profile: "资料待补",
  evidence: "证据待补",
  skill: "能力待学",
};

export const ROADMAP_KIND_IDS = ["foundation", "project", "practice", "validation"];
export const ROADMAP_STATUS_IDS = ["planned", "in_progress", "done"];

export const ROADMAP_KIND_LABELS = {
  foundation: "基础学习",
  project: "项目实战",
  practice: "面试练习",
  validation: "结果验收",
};

export const ROADMAP_STATUS_LABELS = {
  planned: "待开始",
  in_progress: "进行中",
  done: "已完成",
};

function text(value) {
  return String(value || "").trim();
}

export function normalizePreparationGapKind(value, gap = {}) {
  if (PREPARATION_GAP_KIND_IDS.includes(value)) return value;
  const haystack = [gap.area, gap.evidence, gap.impact, gap.practice, ...(gap.actions || [])]
    .map(text)
    .join(" ")
    .toLocaleLowerCase();
  if (/姓名|联系方式|工作经历|任职|教育|学历|时间|职责|个人资料|profile|history/u.test(haystack)) {
    return "profile";
  }
  if (/学习|掌握|基础知识|原理|课程|能力缺口|不会|不熟悉|study|learn|skill/u.test(haystack)) {
    return "skill";
  }
  return "evidence";
}

export function preparationGapCounts(gaps = []) {
  return gaps.reduce(
    (counts, gap) => {
      counts[normalizePreparationGapKind(gap?.kind, gap)] += 1;
      return counts;
    },
    { profile: 0, evidence: 0, skill: 0 },
  );
}

export function normalizeRoadmapMilestone(value = {}, index = 0) {
  const kind = ROADMAP_KIND_IDS.includes(value.kind) ? value.kind : "foundation";
  const status = ROADMAP_STATUS_IDS.includes(value.status) ? value.status : "planned";
  return {
    phase: text(value.phase) || `阶段 ${index + 1}`,
    title: text(value.title) || "待补充阶段目标",
    kind,
    duration: text(value.duration),
    objective: text(value.objective),
    tasks: Array.isArray(value.tasks) ? value.tasks.map(text).filter(Boolean) : [],
    deliverable: text(value.deliverable),
    successCriteria: Array.isArray(value.successCriteria)
      ? value.successCriteria.map(text).filter(Boolean)
      : Array.isArray(value.success_criteria)
        ? value.success_criteria.map(text).filter(Boolean)
        : [],
    status,
  };
}
