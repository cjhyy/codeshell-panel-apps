export const PROJECT_CANDIDATE_TEMPLATE_PATHS = [
  "career-data/profile.md",
  "career-data/work-experience.md",
  "career-data/projects.md",
  "career-data/interview-notes.md",
  "career-data/jd/README.md",
];

function text(value) {
  return String(value || "").trim();
}

export function resolveProjectBootstrapStatus({
  snapshotUnreadable = false,
  hasCodeshellFile = false,
  hasSnapshot = false,
  profile = {},
  repositories = [],
  experiences = [],
  resumeMarkdown = "",
} = {}) {
  const profileName = text(profile?.name);
  const profileReady = Boolean(
    profileName &&
    !["等待 Agent 识别", "当前项目"].includes(profileName) &&
    (text(profile?.target) || text(profile?.summary) || text(profile?.role)),
  );
  const repositoryCount = Array.isArray(repositories) ? repositories.length : 0;
  const experienceCount = Array.isArray(experiences) ? experiences.length : 0;
  const hasCandidateData =
    profileReady || repositoryCount + experienceCount > 0 || Boolean(text(resumeMarkdown));

  if (snapshotUnreadable) {
    return {
      state: "blocked",
      label: "数据源需要修复",
      title: "数据源快照暂时无法读取",
      detail: "为避免覆盖已有数据，初始化已暂停。修复或备份 job-hunt-panel.json 后再重试。",
      button: "初始化暂不可用",
    };
  }
  if (hasCodeshellFile && hasSnapshot && hasCandidateData) {
    return {
      state: "ready",
      label: "数据源已就绪",
      title: "求职数据源已经可以使用",
      detail: `已识别 ${experienceCount} 段经历、${repositoryCount} 个 Repo / 项目证据；可重新扫描补充新资料。`,
      button: "重新扫描数据源",
    };
  }
  if (hasCodeshellFile && hasSnapshot) {
    return {
      state: "partial",
      label: "数据结构已建立 · 待识别资料",
      title: "继续让 Agent 识别数据源",
      detail:
        "基础文件已经存在，但还没有可用于简历的经历或项目证据。Agent 会继续扫描并留下待补项。",
      button: "继续识别资料",
    };
  }
  return {
    state: "missing",
    label: "数据源尚未建立",
    title: "先建立求职数据源",
    detail:
      "Agent 会先复用已有资料，再补齐 CODESHELL.md、求职数据模板和面板快照；不会打开其他 Repo。",
    button: "✦ 初始化数据源",
  };
}

export function buildProjectBootstrapTask({
  workspace = "",
  projectName = "",
  hasCodeshellFile = false,
  hasSnapshot = false,
  resumeEvidenceProtocol = "",
} = {}) {
  const prompt = [
    "请使用 job-hunt-hq:job-hunt-workflow skill 和 panel-app:job-hunt-hq 工具，初始化当前 CodeShell 项目为可持续维护的求职数据项目。",
    "这是用户从面板明确发起的项目内初始化。只处理当前项目，不打开、切换或修改其他 Repo。",
    '先调用 get_job_search_context，参数使用 {"scope":"candidate","limit":25}，再检查当前项目根目录、明显的简历/经历/项目说明文件以及当前 Git 仓库的只读元数据。不要无目的遍历依赖目录、构建产物或大型二进制文件。',
    "按以下规则初始化：",
    "1. 优先复用已有文件和目录，不复制同一份资料，不改变现有项目结构。",
    "2. 如果没有 CODESHELL.md，创建它；如果已经存在，只在必要时增加或更新一个清晰的 Job Hunt HQ 小节，保留其他项目指令。该小节写明资料路径、目标方向和事实边界，明确禁止编造指标。",
    `3. 只有当现有资料没有合适归属时，才创建以下缺失文件：${PROJECT_CANDIDATE_TEMPLATE_PATHS.join("、")}。模板使用明确的 TODO，不要把占位文字当成候选人事实。`,
    "4. 从已有资料提取可核验的个人定位、工作经历与项目证据。Git 仓库存在不等于用户贡献；只有作者归属和实际改动可确认时才把 Commit 当证据。",
    "5. 调用 save_candidate_context 写回识别结果；没有识别出的数组传空数组，不要编造内容。确保结构化结果保存到当前项目的 job-hunt-panel.json。",
    "6. 如果已能推断一个主要求职大类，并且至少有足够证据支持 3 条真实简历要点，再按 resume-quality 规则调用 save_resume_draft 生成第一份 Base Resume；否则只完成初始化，并在当前 Session 用最短清单说明还需要用户补哪几项真实信息。",
    text(resumeEvidenceProtocol),
    "完成后简要说明复用了哪些文件、创建了哪些文件、识别了多少经历与项目，以及是否生成 Base Resume。",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    prompt,
    displayText: "Agent 正在初始化当前求职项目，结果会自动写回面板",
    metadata: {
      instruction:
        "初始化当前求职项目：复用已有资料，补齐缺失结构，识别候选人证据，并在证据足够时生成第一份 Base Resume。",
      target: {
        kind: "project-bootstrap",
        title: text(projectName) || "当前求职项目",
        detail: hasCodeshellFile
          ? "保留现有 CODESHELL.md，重新扫描并补全"
          : "创建求职数据结构并识别已有资料",
        payload: {
          workspace: text(workspace),
          hasCodeshellFile: Boolean(hasCodeshellFile),
          hasProjectSnapshot: Boolean(hasSnapshot),
        },
      },
    },
  };
}
