function text(value) {
  return String(value || "").trim();
}

function meaningfulName(value) {
  const name = text(value);
  return Boolean(name && !["等待 Agent 识别", "当前项目"].includes(name));
}

function hasExperienceEvidence(experience) {
  return Boolean(
    (text(experience?.company) || text(experience?.role)) &&
      (experience?.achievements || []).some((achievement) => text(achievement)),
  );
}

function hasRepositoryEvidence(repository) {
  return Boolean(
    text(repository?.name) &&
      text(repository?.summary) &&
      (text(repository?.path) || text(repository?.tech)),
  );
}

export function resolveCandidateSourceReadiness({
  workspace = "",
  hasCodeshellFile = false,
  hasSnapshot = false,
  snapshotUnreadable = false,
  profile = {},
  experiences = [],
  repositories = [],
  baseResumeCount = 0,
} = {}) {
  const safeExperiences = Array.isArray(experiences) ? experiences : [];
  const safeRepositories = Array.isArray(repositories) ? repositories : [];
  const profileParts = {
    name: meaningfulName(profile?.name),
    direction: Boolean(text(profile?.role) || text(profile?.target)),
    summary: Boolean(text(profile?.summary)),
    contact: Boolean(text(profile?.contact)),
  };
  const projectReady = Boolean(
    text(workspace) && hasCodeshellFile && hasSnapshot && !snapshotUnreadable,
  );
  const profileReady = Object.values(profileParts).every(Boolean);
  const experienceReady = safeExperiences.some(hasExperienceEvidence);
  const repositoryReady = safeRepositories.some(hasRepositoryEvidence);
  const resumeReady = Number(baseResumeCount) > 0;
  const signals = [
    { id: "project", label: "项目已绑定", ready: projectReady },
    { id: "profile", label: "个人定位完整", ready: profileReady },
    { id: "experience", label: "工作经历有成果", ready: experienceReady },
    { id: "evidence", label: "项目证据可核验", ready: repositoryReady },
    { id: "base", label: "Base Resume 已建立", ready: resumeReady },
  ];
  const readyCount = signals.filter((signal) => signal.ready).length;
  const score = Math.round((readyCount / signals.length) * 100);
  const gaps = [];

  if (!projectReady) {
    gaps.push({
      id: "project",
      kind: snapshotUnreadable ? "blocked" : "missing",
      title: snapshotUnreadable ? "先修复项目快照" : "先建立求职数据项目",
      detail: snapshotUnreadable
        ? "job-hunt-panel.json 当前无法安全读取，面板不会自动覆盖。"
        : "让 Agent 绑定当前项目，复用已有资料并只补齐缺失结构。",
    });
  }
  if (!profileReady) {
    const missing = [];
    if (!profileParts.name) missing.push("姓名");
    if (!profileParts.direction) missing.push("目标角色");
    if (!profileParts.summary) missing.push("职业简介");
    if (!profileParts.contact) missing.push("联系方式");
    gaps.push({
      id: "profile",
      kind: meaningfulName(profile?.name) ? "weak" : "missing",
      title: "补齐个人定位",
      detail: `还缺：${missing.join("、")}。这些信息决定 Base Resume 的招聘定位。`,
    });
  }
  if (!experienceReady) {
    gaps.push({
      id: "experience",
      kind: safeExperiences.length ? "weak" : "missing",
      title: safeExperiences.length ? "给工作经历补上真实成果" : "添加至少一段工作经历",
      detail: safeExperiences.length
        ? "已识别经历，但还缺你具体做了什么、解决了什么问题、结果如何。"
        : "提供公司、角色、时间和 2–4 条真实贡献，不需要先写成简历句子。",
    });
  }
  if (!repositoryReady) {
    gaps.push({
      id: "evidence",
      kind: safeRepositories.length ? "weak" : "missing",
      title: safeRepositories.length ? "补齐 Repo 的个人贡献证据" : "连接可核验的项目或 Repo",
      detail: safeRepositories.length
        ? "说清你负责的部分、技术取舍和可核验的路径或 Commit。"
        : "Repo 不会自动等于你的贡献；Agent 只会采用能确认归属的证据。",
    });
  }
  if (!resumeReady) {
    gaps.push({
      id: "base",
      kind: readyCount >= 4 ? "next" : "missing",
      title: readyCount >= 4 ? "生成第一份 Base Resume" : "完成基础资料后建立 Base Resume",
      detail: readyCount >= 4
        ? "当前资料已经足以生成方向级基础简历，之后再从它派生 JD 定制版。"
        : "Base Resume 是可长期维护的基线，不应该一上来就被单个 JD 改写。",
    });
  }

  let label = "先补齐基础资料";
  if (score === 100) label = "求职基线已就绪";
  else if (score >= 60) label = "可以开始，仍有缺口";

  return {
    score,
    readyCount,
    total: signals.length,
    label,
    detail: `已确认 ${readyCount}/${signals.length} 个关键来源。只用项目内可核验事实，不会为了填满简历编造内容。`,
    signals,
    gaps,
  };
}
