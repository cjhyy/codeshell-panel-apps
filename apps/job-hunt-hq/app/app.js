import {
  JD_COMPLETENESS_LABELS,
  normalizeJdCompleteness,
  upsertJobOpportunities,
} from "./job-opportunities.mjs";

const STORAGE_KEY = "job-hunt-state-v1";
const PREVIEW_PREFIX = "codeshell-job-hunt-hq:";
const PROJECT_STATE_PATH = "job-hunt-panel.json";

const JOB_PROVIDERS = [
  { id: "boss", label: "BOSS 直聘", domain: "zhipin.com" },
  { id: "linkedin", label: "LinkedIn", domain: "linkedin.com/jobs" },
  { id: "lagou", label: "拉勾", domain: "lagou.com" },
  { id: "liepin", label: "猎聘", domain: "liepin.com" },
  { id: "maimai", label: "脉脉", domain: "maimai.cn" },
  { id: "51job", label: "前程无忧", domain: "51job.com" },
  { id: "zhaopin", label: "智联招聘", domain: "zhaopin.com" },
  { id: "official", label: "公司官网", domain: "company career pages" },
];

const PROVIDER_BY_ID = new Map(JOB_PROVIDERS.map((provider) => [provider.id, provider]));

const KEYWORD_RULES = [
  { label: "React", tokens: ["react", "next.js", "nextjs"] },
  { label: "TypeScript", tokens: ["typescript", "ts"] },
  { label: "AI Agent", tokens: ["ai agent", "agent", "智能体"] },
  { label: "LLM 应用", tokens: ["llm", "大模型", "生成式 ai", "prompt"] },
  { label: "前端工程化", tokens: ["工程化", "构建", "vite", "webpack", "monorepo"] },
  { label: "Electron", tokens: ["electron", "桌面端", "跨端"] },
  { label: "Node.js", tokens: ["node.js", "nodejs", "node "] },
  { label: "产品意识", tokens: ["产品意识", "产品思维", "用户体验", "业务理解"] },
  { label: "系统设计", tokens: ["系统设计", "架构设计", "技术架构"] },
  { label: "性能优化", tokens: ["性能优化", "性能", "首屏", "渲染"] },
  { label: "可视化", tokens: ["可视化", "图表", "canvas", "webgl"] },
  { label: "协作沟通", tokens: ["沟通", "协作", "跨团队", "推动"] },
  { label: "英语", tokens: ["英语", "英文"] },
  { label: "本科", tokens: ["本科", "学士"] },
];

const STATUS_LABELS = {
  saved: "已收藏",
  tailoring: "定制中",
  applied: "已投递",
};

const INTERVIEW_MODE_LABELS = {
  balanced: "综合面试",
  technical: "技术深挖",
  project: "项目复盘",
  behavioral: "行为面试",
  "system-design": "系统设计",
};

const WORKFLOW_TASKS = {
  resume: { label: "简历优化", requiresJob: false },
  match: { label: "JD 匹配", requiresJob: true },
  intel: { label: "公司与面经", requiresJob: true },
  questions: { label: "定制题库", requiresJob: true },
  prepare: { label: "补强计划", requiresJob: false },
  mock: { label: "模拟面试", requiresJob: true },
  debrief: { label: "真实复盘", requiresJob: false },
};

const WORKFLOW_PRESETS = {
  resume: ["resume", "match", "prepare"],
  interview: ["match", "intel", "questions", "prepare"],
  debrief: ["debrief", "prepare", "resume"],
  full: ["resume", "match", "intel", "questions", "prepare"],
};

const PANEL_VIEWS = new Set(["dashboard", "materials", "research", "resumes", "interviews"]);

const seedState = {
  selectedJobId: "job-aurora",
  selectedInterviewSetId: "iset-aurora",
  workflowJobIds: ["job-aurora"],
  workflowTaskIds: ["resume", "match", "prepare"],
  activeView: "dashboard",
  statusFilter: "all",
  jobFilter: "all",
  jobSourceFilter: "all",
  interviewCategoryFilter: "全部",
  profile: {
    name: "林默",
    role: "前端 / AI 产品工程师",
    contact: "linmo@example.com · 上海",
    target: "AI 应用、开发者工具、前端平台",
    summary:
      "5 年前端与产品工程经验，擅长把复杂工作流做成清晰、可靠的产品体验，近期聚焦 AI Agent、开发者工具与跨端应用。",
  },
  jobs: [
    {
      id: "job-aurora",
      company: "Aurora Labs",
      title: "AI 产品前端工程师",
      location: "上海",
      salary: "30–45K · 15薪",
      source: "BOSS 直聘",
      sourceId: "boss",
      url: "https://www.zhipin.com/",
      description:
        "负责 AI Agent 产品的前端架构与核心体验，使用 React、TypeScript 和现代前端工程化体系交付高质量功能；与产品、算法和设计团队紧密协作，理解大模型能力边界并推动 LLM 应用落地；关注复杂交互、性能优化与可维护性。有 Electron、Node.js、开发者工具或 AI 产品经验优先。",
      match: 94,
      status: "tailoring",
      createdAt: "2026-07-29T08:30:00.000Z",
      sample: true,
    },
    {
      id: "job-nova",
      company: "NovaFlow",
      title: "高级前端工程师 · 开发者工具",
      location: "上海 / 远程",
      salary: "28–42K · 14薪",
      source: "LinkedIn",
      sourceId: "linkedin",
      url: "https://www.linkedin.com/jobs/",
      description:
        "参与开发者工具与桌面端产品建设，主导 React、TypeScript、Electron 技术方案和系统设计。需要具备前端工程化、性能优化、跨团队协作和复杂状态管理经验；有 Node.js、Monorepo 与 AI 辅助编程产品经验加分。",
      match: 89,
      status: "saved",
      createdAt: "2026-07-28T10:20:00.000Z",
      sample: true,
    },
    {
      id: "job-pulse",
      company: "Pulse AI",
      title: "AI 应用工程师",
      location: "杭州",
      salary: "25–40K · 16薪",
      source: "猎聘",
      sourceId: "liepin",
      url: "https://www.liepin.com/",
      description:
        "面向企业客户构建 LLM 应用与 Agent 工作流，负责从需求理解、原型验证到前端交付。熟悉 React、TypeScript、Node.js，了解 Prompt 设计、检索增强与模型评估；重视产品意识、用户体验和业务价值。",
      match: 82,
      status: "saved",
      createdAt: "2026-07-27T03:40:00.000Z",
      sample: true,
    },
  ],
  repos: [
    {
      id: "repo-codeshell",
      name: "CodeShell",
      path: "github.com/example/codeshell",
      tech: "TypeScript · React · Electron · AI Agent",
      summary:
        "设计并实现多 Agent 编排与跨端交互工作流，把复杂运行状态收敛为可理解、可恢复的产品体验。",
    },
    {
      id: "repo-console",
      name: "Observability Console",
      path: "packages/console",
      tech: "React · TypeScript · Canvas",
      summary: "重构大数据量时间线渲染与筛选交互，降低页面卡顿并提升问题定位效率。",
    },
  ],
  experiences: [
    {
      id: "exp-arc",
      company: "弧光科技",
      role: "高级前端工程师",
      period: "2022.06 — 至今",
      achievements: [
        "负责 AI 工作台核心体验与前端架构，协同产品、设计和算法团队推进复杂功能落地。",
        "建设可复用的状态管理与组件体系，缩短多条业务线的功能交付周期。",
        "推动桌面端性能排查和渲染优化，改善长会话场景下的交互稳定性。",
      ],
    },
    {
      id: "exp-bay",
      company: "湾流网络",
      role: "前端工程师",
      period: "2020.07 — 2022.05",
      achievements: [
        "参与企业级数据产品从 0 到 1 的前端研发，负责可视化工作台和权限配置体验。",
        "建立 TypeScript 与前端质量规范，减少多人协作中的重复问题。",
      ],
    },
  ],
  jobResearch: [
    {
      id: "research-aurora",
      jobId: "job-aurora",
      updatedAt: "2026-07-29T09:10:00.000Z",
      sample: true,
      company: {
        officialName: "Aurora Labs",
        website: "https://example.com/",
        careersUrl: "https://example.com/careers",
        summary:
          "示例调研数据：一家面向企业团队提供 AI 工作流产品的技术公司，当前招聘信号集中在 Agent 产品体验和开发者工具。",
        industry: "AI 软件",
        stage: "信息待核验",
        size: "信息待核验",
        locations: ["上海"],
        products: ["企业 AI 工作台", "Agent 工作流"],
        techSignals: ["React", "TypeScript", "Electron"],
        hiringSignals: ["AI 产品前端", "开发者工具"],
      },
      reviews: [
        {
          source: "示例公开评价",
          title: "协作与成长",
          url: "https://example.com/reviews",
          publishedAt: "",
          sentiment: "mixed",
          summary: "示例摘要：部分公开讨论认可产品探索空间，同时提到跨团队协作节奏较快。",
          pros: ["产品方向新", "工程影响面大"],
          cons: ["需求变化可能较快"],
          confidence: "low",
        },
      ],
      interviewIntel: {
        summary: "示例情报：公开讨论中常见项目深挖、React 性能和 AI 产品边界判断。",
        process: ["招聘沟通", "技术面试", "项目与业务面试"],
        themes: ["React 性能", "Agent 产品", "项目决策"],
        questions: [
          {
            question: "如何设计支持流式输出和工具调用的前端状态模型？",
            category: "系统设计",
            origin: "predicted",
            sourceUrl: "",
          },
          {
            question: "介绍一次复杂产品需求中的方案取舍。",
            category: "项目深挖",
            origin: "reported",
            sourceUrl: "https://example.com/interviews",
          },
        ],
      },
      risks: ["公司规模与融资阶段仍需从可靠来源核验", "匿名评价样本不足"],
      sources: [
        {
          kind: "official",
          title: "Aurora Labs 示例官网",
          publisher: "Aurora Labs",
          url: "https://example.com/",
          publishedAt: "",
          accessedAt: "2026-07-29T09:10:00.000Z",
          notes: "浏览器预览示例，不代表真实公司信息。",
        },
        {
          kind: "interview",
          title: "示例面试讨论",
          publisher: "示例来源",
          url: "https://example.com/interviews",
          publishedAt: "",
          accessedAt: "2026-07-29T09:10:00.000Z",
          notes: "低置信度示例。",
        },
      ],
    },
  ],
  workflowRuns: [
    {
      id: "workflow-preview",
      status: "completed",
      currentStep: "artifacts",
      message: "示例工作流已完成",
      createdAt: "2026-07-29T08:30:00.000Z",
      updatedAt: "2026-07-29T09:20:00.000Z",
      steps: [
        { id: "discover", status: "completed", message: "找到 3 个示例岗位" },
        { id: "verify-jd", status: "completed", message: "保存完整 JD" },
        { id: "company", status: "completed", message: "完成 1 份示例调研" },
        { id: "reviews", status: "completed", message: "汇总公开评价" },
        { id: "interviews", status: "completed", message: "汇总面试情报" },
        { id: "artifacts", status: "completed", message: "生成准备材料" },
      ],
    },
  ],
  resume: {
    jobId: "",
    title: "",
    markdown: "",
    notes: [],
    updatedAt: "",
  },
  versions: [],
  interviewSets: [
    {
      id: "iset-aurora",
      jobId: "job-aurora",
      title: "Aurora Labs · AI 产品前端工程师",
      mode: "balanced",
      difficulty: "进阶",
      createdAt: "2026-07-29T09:20:00.000Z",
      questions: [
        {
          id: "q-agent-architecture",
          category: "项目深挖",
          difficulty: "进阶",
          question:
            "请用 3 分钟介绍你在 CodeShell 中如何拆分多 Agent 编排、运行状态和用户界面之间的职责边界。",
          why: "JD 强调 AI Agent 产品与前端架构，需要确认你是否真正参与过核心方案设计。",
          evidenceRefs: ["Repo · CodeShell", "弧光科技 · AI 工作台"],
          answerPoints: ["先讲业务问题与约束", "说明关键架构选择和取舍", "用结果或故障案例收尾"],
          followUps: ["如果 Agent 执行中断，状态如何恢复？"],
        },
        {
          id: "q-react-performance",
          category: "技术基础",
          difficulty: "进阶",
          question:
            "长会话持续追加消息时，React 页面为什么会越来越卡？你会如何定位并设计渲染优化方案？",
          why: "JD 明确要求 React、性能优化和复杂交互能力，并可对应你已有的长会话优化经历。",
          evidenceRefs: ["弧光科技 · 长会话性能", "React"],
          answerPoints: [
            "建立可复现基线",
            "区分计算、提交和绘制成本",
            "说明窗口化、状态切片与缓存取舍",
          ],
          followUps: ["如果虚拟列表高度不固定怎么办？"],
        },
        {
          id: "q-system-design",
          category: "系统设计",
          difficulty: "挑战",
          question:
            "设计一个支持模型流式输出、工具调用、暂停恢复和多会话切换的 AI 工作台前端，你会如何划分状态与事件协议？",
          why: "这是目标岗位最可能出现的综合设计题，覆盖 Agent、系统设计与前端工程化。",
          evidenceRefs: ["Repo · CodeShell", "JD · AI Agent 产品"],
          answerPoints: [
            "先定义状态机和事件边界",
            "区分持久状态与瞬时 UI 状态",
            "讨论幂等、恢复和错误隔离",
          ],
          followUps: ["多窗口同时操作时如何避免状态冲突？"],
        },
        {
          id: "q-collaboration",
          category: "行为面试",
          difficulty: "基础",
          question: "讲一个你与产品、设计或算法团队对方案判断不一致的例子。你如何推动达成结论？",
          why: "JD 强调跨团队协作，需要用真实事件验证影响力，而不只是沟通意愿。",
          evidenceRefs: ["弧光科技 · 跨团队协作"],
          answerPoints: ["用 STAR 结构", "说清分歧和各方目标", "突出你采取的动作与最终结果"],
          followUps: ["如果最后证明你的判断错了，你会怎么处理？"],
        },
        {
          id: "q-gap-metrics",
          category: "能力差距",
          difficulty: "挑战",
          question:
            "你的材料提到性能和交付效率改善，但缺少具体数字。面试中你会如何在不夸大的前提下证明影响？",
          why: "当前材料的量化结果不足，这是面试官最容易继续追问的可信度风险。",
          evidenceRefs: ["材料缺口 · 量化结果"],
          answerPoints: ["区分已知事实与合理区间", "说明测量口径", "无法确认的数据明确不报精确值"],
          followUps: ["你当时为什么没有建立数据基线？"],
        },
      ],
    },
  ],
  preparationPlans: [
    {
      id: "plan-aurora",
      jobId: "job-aurora",
      title: "Aurora Labs · 面试补强计划",
      summary:
        "项目架构和前端性能是已有优势；当前优先补齐量化结果、LLM 评估实践和跨团队决策案例。",
      strengths: ["AI Agent 产品经历", "React 性能与复杂状态", "桌面端与开发者工具"],
      gaps: [
        {
          area: "量化结果",
          evidence: "简历描述了性能与交付改善，但没有可核验的指标口径。",
          impact: "面试官可能继续追问影响范围与结果可信度。",
          priority: "high",
          actions: ["回查性能基线、时间窗口和可公开指标", "准备无法给精确值时的诚实表达"],
          practice: "用 90 秒说明一次性能改进，区分事实、区间和无法确认的数据。",
        },
        {
          area: "LLM 评估",
          evidence: "JD 强调大模型能力边界，现有材料主要体现产品和前端实现。",
          impact: "可能难以回答模型效果、成本和质量如何被验证。",
          priority: "medium",
          actions: ["整理一次真实的模型选型或 Prompt 迭代过程", "补充失败案例与评估方法"],
          practice: "回答“如何判断一个 Agent 功能真的变好了”。",
        },
      ],
      resumeChanges: ["把“改善长会话稳定性”改成可核验的问题、动作与结果三段式表达"],
      nextActions: [
        {
          title: "补齐长会话性能案例",
          kind: "evidence",
          detail: "确认基线、优化动作、影响范围和可以公开的结果。",
          priority: "high",
        },
        {
          title: "练习 Agent 评估题",
          kind: "practice",
          detail: "准备指标、样本、失败分类与线上反馈闭环。",
          priority: "medium",
        },
      ],
      updatedAt: "2026-07-29T09:25:00.000Z",
      sample: true,
    },
  ],
  interviewDebriefs: [
    {
      id: "debrief-aurora",
      jobId: "job-aurora",
      round: "一面 · 技术面",
      interviewedAt: "2026-07-29T10:00:00.000Z",
      outcome: "pending",
      summary: "示例复盘：项目架构说明清楚，但性能结果和模型评估回答不够具体。",
      questions: [
        {
          question: "长会话性能优化前后的指标是什么？",
          answerSummary: "说明了定位过程，但没有给出明确基线和验证窗口。",
          signal: "weak",
          reportedFeedback: "",
          analysis: "需要先确认能公开的数据，再用统一口径表达。",
          betterAnswerPoints: ["问题规模与基线", "采取的动作", "验证方法", "真实结果或限制"],
        },
      ],
      strengths: ["架构边界表达清楚", "能解释技术取舍"],
      gaps: ["量化结果不足", "模型评估案例不完整"],
      nextActions: ["更新性能案例表述", "补练 Agent 评估与失败分析"],
      createdAt: "2026-07-29T10:30:00.000Z",
      sample: true,
    },
  ],
};

function emptyProjectState() {
  return {
    ...clone(seedState),
    selectedJobId: "",
    selectedInterviewSetId: "",
    workflowJobIds: [],
    workflowTaskIds: ["resume", "prepare"],
    activeView: "dashboard",
    profile: {
      name: "等待 Agent 识别",
      role: "当前项目",
      contact: "",
      target: "",
      summary: "",
    },
    jobs: [],
    repos: [],
    experiences: [],
    jobResearch: [],
    workflowRuns: [],
    resume: {
      jobId: "",
      title: "",
      markdown: "",
      notes: [],
      updatedAt: "",
    },
    versions: [],
    interviewSets: [],
    preparationPlans: [],
    interviewDebriefs: [],
  };
}

const elements = {
  workspaceLabel: document.querySelector("#workspace-label"),
  lastSaved: document.querySelector("#last-saved"),
  sideProfileName: document.querySelector("#side-profile-name"),
  sideProfileRole: document.querySelector("#side-profile-role"),
  jobNavCount: document.querySelector("#job-nav-count"),
  sourceNavCount: document.querySelector("#source-nav-count"),
  researchNavCount: document.querySelector("#research-nav-count"),
  resumeNavCount: document.querySelector("#resume-nav-count"),
  interviewNavCount: document.querySelector("#interview-nav-count"),
  allCount: document.querySelector("#all-count"),
  savedCount: document.querySelector("#saved-count"),
  tailoringCount: document.querySelector("#tailoring-count"),
  appliedCount: document.querySelector("#applied-count"),
  statJobs: document.querySelector("#stat-jobs"),
  statSourceDetail: document.querySelector("#stat-source-detail"),
  statMatch: document.querySelector("#stat-match"),
  statSources: document.querySelector("#stat-sources"),
  statNext: document.querySelector("#stat-next"),
  statNextDetail: document.querySelector("#stat-next-detail"),
  jobList: document.querySelector("#job-list"),
  jobSourceFilter: document.querySelector("#job-source-filter"),
  emptyAddJob: document.querySelector("#empty-add-job"),
  resumeTitle: document.querySelector("#resume-title"),
  resumeJobLabel: document.querySelector("#resume-job-label"),
  resumeUpdated: document.querySelector("#resume-updated"),
  resumePreview: document.querySelector("#resume-preview"),
  resumeEditor: document.querySelector("#resume-editor"),
  jdPreview: document.querySelector("#jd-preview"),
  generateResume: document.querySelector("#generate-resume"),
  saveResume: document.querySelector("#save-resume"),
  matchScore: document.querySelector("#match-score"),
  keywordCount: document.querySelector("#keyword-count"),
  keywordList: document.querySelector("#keyword-list"),
  coverageLabel: document.querySelector("#coverage-label"),
  coverageList: document.querySelector("#coverage-list"),
  openSourceJob: document.querySelector("#open-source-job"),
  advanceJob: document.querySelector("#advance-job"),
  askAgent: document.querySelector("#ask-agent"),
  profileName: document.querySelector("#profile-name"),
  profileRole: document.querySelector("#profile-role"),
  profileContact: document.querySelector("#profile-contact"),
  profileTarget: document.querySelector("#profile-target"),
  profileSummary: document.querySelector("#profile-summary"),
  repoList: document.querySelector("#repo-list"),
  repoCount: document.querySelector("#repo-count"),
  experienceList: document.querySelector("#experience-list"),
  experienceCount: document.querySelector("#experience-count"),
  projectContextName: document.querySelector("#project-context-name"),
  projectContextState: document.querySelector("#project-context-state"),
  projectSessionState: document.querySelector("#project-session-state"),
  codeshellFileState: document.querySelector("#codeshell-file-state"),
  projectSnapshotState: document.querySelector("#project-snapshot-state"),
  workflowStatus: document.querySelector("#workflow-status"),
  researchReportCount: document.querySelector("#research-report-count"),
  researchReportList: document.querySelector("#research-report-list"),
  researchJobLabel: document.querySelector("#research-job-label"),
  researchTitle: document.querySelector("#research-title"),
  researchUpdated: document.querySelector("#research-updated"),
  researchEmpty: document.querySelector("#research-empty"),
  researchContent: document.querySelector("#research-content"),
  researchCompanySite: document.querySelector("#research-company-site"),
  researchCareersSite: document.querySelector("#research-careers-site"),
  companySummary: document.querySelector("#company-summary"),
  companyFacts: document.querySelector("#company-facts"),
  companyProducts: document.querySelector("#company-products"),
  companyTech: document.querySelector("#company-tech"),
  companyReviews: document.querySelector("#company-reviews"),
  interviewIntelSummary: document.querySelector("#interview-intel-summary"),
  interviewProcess: document.querySelector("#interview-process"),
  interviewThemes: document.querySelector("#interview-themes"),
  reportedQuestions: document.querySelector("#reported-questions"),
  researchRisks: document.querySelector("#research-risks"),
  researchSources: document.querySelector("#research-sources"),
  workflowBuilder: document.querySelector("#workflow-builder"),
  workflowJobPicker: document.querySelector("#workflow-job-picker"),
  workflowTaskPicker: document.querySelector("#workflow-task-picker"),
  workflowSelectionSummary: document.querySelector("#workflow-selection-summary"),
  runCustomWorkflow: document.querySelector("#run-custom-workflow"),
  runCompanyResearch: document.querySelector("#run-company-research"),
  continueResearchSession: document.querySelector("#continue-research-session"),
  resumeVersionList: document.querySelector("#resume-version-list"),
  interviewSetCount: document.querySelector("#interview-set-count"),
  interviewSetList: document.querySelector("#interview-set-list"),
  interviewJobLabel: document.querySelector("#interview-job-label"),
  interviewSetTitle: document.querySelector("#interview-set-title"),
  interviewQuestionCount: document.querySelector("#interview-question-count"),
  interviewEvidenceCount: document.querySelector("#interview-evidence-count"),
  interviewCategoryCount: document.querySelector("#interview-category-count"),
  interviewCategoryFilters: document.querySelector("#interview-category-filters"),
  interviewQuestionList: document.querySelector("#interview-question-list"),
  simulateInterview: document.querySelector("#simulate-interview"),
  regenerateInterview: document.querySelector("#regenerate-interview"),
  preparationTitle: document.querySelector("#preparation-title"),
  preparationSummary: document.querySelector("#preparation-summary"),
  preparationStrengths: document.querySelector("#preparation-strengths"),
  preparationGapList: document.querySelector("#preparation-gap-list"),
  preparationActionList: document.querySelector("#preparation-action-list"),
  debriefCount: document.querySelector("#debrief-count"),
  interviewDebriefList: document.querySelector("#interview-debrief-list"),
  refreshPreparationPlan: document.querySelector("#refresh-preparation-plan"),
  startInterviewDebrief: document.querySelector("#start-interview-debrief"),
  sessionBridge: document.querySelector("#session-bridge"),
  sessionContextKind: document.querySelector("#session-context-kind"),
  sessionContextTitle: document.querySelector("#session-context-title"),
  sessionContextDetail: document.querySelector("#session-context-detail"),
  sessionQuickActions: document.querySelector("#session-quick-actions"),
  sessionInstruction: document.querySelector("#session-instruction"),
  sessionBridgeState: document.querySelector("#session-bridge-state"),
  sessionBridgeStateLabel: document.querySelector("#session-bridge-state-label"),
  sendSessionInstruction: document.querySelector("#send-session-instruction"),
  discussJobSession: document.querySelector("#discuss-job-session"),
  continueResumeSession: document.querySelector("#continue-resume-session"),
  toast: document.querySelector("#toast"),
};

let state = structuredClone(seedState);
let context = { cwd: null, trusted: false, busy: false };
let projectContext = {
  name: "当前项目",
  hasCodeshellFile: false,
  hasSnapshot: false,
  lastSyncedAt: "",
};
let resumeMode = "preview";
let toastTimer = null;
let saveTimer = null;
let sessionBridgeContext = {
  kind: "panel",
  title: "当前求职面板",
  detail: "Agent 会读取当前项目、岗位和面板中的最新结构化数据。",
  payload: {},
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSourceId(sourceId, sourceLabel = "") {
  const explicit = String(sourceId || "")
    .trim()
    .toLowerCase();
  if (PROVIDER_BY_ID.has(explicit)) return explicit;
  const label = String(sourceLabel || "").toLowerCase();
  return (
    JOB_PROVIDERS.find(
      (provider) =>
        label.includes(provider.id) ||
        label.includes(provider.label.toLowerCase()) ||
        label.includes(provider.domain.split("/")[0]),
    )?.id ?? "other"
  );
}

function providerLabel(sourceId, fallback = "") {
  return PROVIDER_BY_ID.get(sourceId)?.label || fallback || "其他";
}

function normalizeJobUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|spm|track|ref|source)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function jobDedupeKey(job) {
  const url = normalizeJobUrl(job.url);
  if (url) return `url:${url}`;
  return jobMetadataKey(job);
}

function jobMetadataKey(job) {
  return [normalizeSourceId(job.sourceId, job.source), job.company, job.title, job.location]
    .map((value) =>
      String(value || "")
        .trim()
        .toLowerCase(),
    )
    .join("|");
}

function mergeState(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return clone(seedState);
  const next = clone(seedState);
  if (input.profile && typeof input.profile === "object") {
    next.profile = { ...next.profile, ...input.profile };
  }
  for (const field of [
    "jobs",
    "repos",
    "experiences",
    "jobResearch",
    "workflowRuns",
    "versions",
    "interviewSets",
    "preparationPlans",
    "interviewDebriefs",
  ]) {
    if (Array.isArray(input[field])) next[field] = input[field];
  }
  if (input.resume && typeof input.resume === "object") {
    next.resume = { ...next.resume, ...input.resume };
  }
  if (typeof input.selectedJobId === "string") next.selectedJobId = input.selectedJobId;
  if (typeof input.selectedInterviewSetId === "string") {
    next.selectedInterviewSetId = input.selectedInterviewSetId;
  }
  if (Array.isArray(input.workflowJobIds)) {
    next.workflowJobIds = input.workflowJobIds.filter((id) => typeof id === "string").slice(0, 20);
  }
  if (Array.isArray(input.workflowTaskIds)) {
    next.workflowTaskIds = input.workflowTaskIds
      .filter((id) => Object.hasOwn(WORKFLOW_TASKS, id))
      .slice(0, Object.keys(WORKFLOW_TASKS).length);
  }
  if (typeof input.activeView === "string" && PANEL_VIEWS.has(input.activeView)) {
    next.activeView = input.activeView;
  }
  if (typeof input.statusFilter === "string") next.statusFilter = input.statusFilter;
  if (typeof input.jobFilter === "string") next.jobFilter = input.jobFilter;
  if (typeof input.jobSourceFilter === "string") {
    next.jobSourceFilter = input.jobSourceFilter;
  }
  if (typeof input.interviewCategoryFilter === "string") {
    next.interviewCategoryFilter = input.interviewCategoryFilter;
  }
  if (next.jobFilter === "boss") {
    next.jobFilter = "all";
    next.jobSourceFilter = "boss";
  }
  next.jobs = next.jobs.map((job) => ({
    ...job,
    sourceId: normalizeSourceId(job.sourceId, job.source),
    jdCompleteness: normalizeJdCompleteness(
      job.jdCompleteness,
      job.description,
      true,
    ),
    verificationNotes: cleanText(job.verificationNotes, 2000),
    fetchedAt: cleanText(job.fetchedAt, 80),
  }));
  if (!next.jobs.some((job) => job.id === next.selectedJobId)) {
    next.selectedJobId = next.jobs[0]?.id ?? "";
  }
  next.workflowJobIds = next.workflowJobIds.filter((id) =>
    next.jobs.some((job) => job.id === id),
  );
  if (!next.interviewSets.some((set) => set.id === next.selectedInterviewSetId)) {
    next.selectedInterviewSetId = next.interviewSets[0]?.id ?? "";
  }
  return next;
}

function mockHostCall(method, params = {}) {
  if (method === "storage.get") {
    return Promise.resolve(
      JSON.parse(localStorage.getItem(`${PREVIEW_PREFIX}${params.key}`) || "null"),
    );
  }
  if (method === "storage.set") {
    localStorage.setItem(`${PREVIEW_PREFIX}${params.key}`, JSON.stringify(params.value));
    return Promise.resolve(true);
  }
  if (method === "workspace.info") {
    return Promise.resolve({
      name: "codeshell",
      root: "/preview/codeshell",
      trusted: true,
      gitBranch: "preview",
    });
  }
  if (method === "workspace.list") {
    return Promise.resolve({
      path: params.path || ".",
      entries: [
        { name: "CODESHELL.md", path: "CODESHELL.md", kind: "file" },
        { name: "package.json", path: "package.json", kind: "file" },
        { name: "packages", path: "packages", kind: "directory" },
        { name: "README.md", path: "README.md", kind: "file" },
      ],
      truncated: false,
    });
  }
  if (method === "workspace.readText") {
    const content = localStorage.getItem(`${PREVIEW_PREFIX}file:${params.path}`);
    if (content == null) return Promise.reject(new Error("file not found"));
    const modifiedAt =
      Number(localStorage.getItem(`${PREVIEW_PREFIX}mtime:${params.path}`)) || Date.now();
    return Promise.resolve({
      path: params.path,
      content,
      size: content.length,
      modifiedAt,
      revision: `preview:${modifiedAt}`,
    });
  }
  if (method === "workspace.writeText") {
    const modifiedAt = Date.now();
    localStorage.setItem(`${PREVIEW_PREFIX}file:${params.path}`, params.content);
    localStorage.setItem(`${PREVIEW_PREFIX}mtime:${params.path}`, String(modifiedAt));
    return Promise.resolve({
      path: params.path,
      size: params.content.length,
      modifiedAt,
      revision: `preview:${modifiedAt}`,
    });
  }
  if (method === "external.open") {
    window.open(params.url, "_blank", "noopener,noreferrer");
    return Promise.resolve(true);
  }
  if (method === "agent.submitPrompt") return Promise.resolve({ accepted: true });
  return Promise.resolve(null);
}

function hostCall(method, params) {
  if (window.codeshellPanel?.call) return window.codeshellPanel.call(method, params);
  return mockHostCall(method, params);
}

function getContext() {
  if (window.codeshellPanel?.getContext) return window.codeshellPanel.getContext();
  return Promise.resolve({
    sessionId: "preview-session",
    cwd: "/preview/codeshell",
    trusted: true,
    busy: false,
    locale: "zh-CN",
  });
}

function updateContext(next) {
  context = { ...context, ...(next ?? {}) };
  const name = context.cwd ? context.cwd.split(/[\\/]/).filter(Boolean).at(-1) : "浏览器预览";
  elements.workspaceLabel.textContent = `${name || "未绑定项目"}${context.busy ? " · Agent 忙碌中" : " · 已连接"}`;
  elements.generateResume.disabled = Boolean(context.busy);
  elements.askAgent.disabled = Boolean(context.busy);
  elements.simulateInterview.disabled = Boolean(context.busy) || !selectedInterviewSet();
  elements.regenerateInterview.disabled = Boolean(context.busy) || !selectedJob();
  elements.runCustomWorkflow.disabled =
    Boolean(context.busy) || state.workflowTaskIds.length === 0;
  elements.runCompanyResearch.disabled = Boolean(context.busy) || !selectedJob();
  elements.refreshPreparationPlan.disabled = Boolean(context.busy);
  elements.startInterviewDebrief.disabled = Boolean(context.busy);
  elements.sendSessionInstruction.disabled = Boolean(context.busy);
  elements.sessionBridgeState.classList.toggle("busy", Boolean(context.busy));
  elements.sessionBridgeStateLabel.textContent = context.busy
    ? " 当前 Session 正在处理任务"
    : " 已绑定当前 Session";
  elements.projectSessionState.textContent = context.sessionId
    ? context.busy
      ? "当前 Session · Agent 执行中"
      : "已绑定当前 Session"
    : "浏览器预览";
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function selectedJob() {
  return state.jobs.find((job) => job.id === state.selectedJobId) ?? null;
}

function selectedInterviewSet() {
  return state.interviewSets.find((set) => set.id === state.selectedInterviewSetId) ?? null;
}

function selectedWorkflowJobs() {
  return state.jobs.filter((job) => state.workflowJobIds.includes(job.id));
}

function selectedPreparationPlan() {
  return selectedJob()
    ? state.preparationPlans.find((plan) => plan.jobId === state.selectedJobId) ?? null
    : state.preparationPlans.find((plan) => !plan.jobId) ?? null;
}

function formatDate(value) {
  if (!value) return "未生成";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚更新";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function slugify(value) {
  const ascii = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return ascii || `resume-${Date.now().toString(36)}`;
}

function notify(message, kind = "default") {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", kind === "error");
  elements.toast.hidden = false;
  toastTimer = setTimeout(
    () => {
      elements.toast.hidden = true;
    },
    kind === "error" ? 5200 : 3200,
  );
}

function sessionActionsFor(target) {
  const common = [
    {
      label: "帮我判断下一步",
      prompt: "根据这个对象和当前求职目标，告诉我最值得优先做的下一步，并说明理由。",
    },
    {
      label: "检查证据",
      prompt: "检查相关结论是否都有真实材料支持，把事实、缺口和推断分开。",
    },
  ];
  const byKind = {
    panel: [
      {
        label: "整理当前进度",
        prompt: "总结当前求职进度、阻塞和下一步，只基于面板已经保存的内容。",
      },
    ],
    jobs: [
      {
        label: "对比这些岗位",
        prompt: "对比这些岗位的匹配度、机会成本和准备投入，给出有证据的优先级。",
      },
    ],
    job: [
      {
        label: "拆解 JD",
        prompt: "拆解这个岗位最重要的要求，映射我已有的证据和真实缺口。",
      },
      {
        label: "准备这个岗位",
        prompt: "为这个岗位更新补强计划和下一步行动，不自动修改简历。",
      },
    ],
    research: [
      {
        label: "继续核验",
        prompt: "检查这份公司与面经调研中证据不足的结论，继续核验并写回报告。",
      },
    ],
    resume: [
      {
        label: "审阅并修改",
        prompt: "审阅当前简历，优先找出最影响筛选通过率的问题，并把完整修改版写回面板。",
      },
      {
        label: "只给修改建议",
        prompt: "审阅当前简历，只给具体修改建议，暂时不要覆盖当前版本。",
      },
    ],
    question: [
      {
        label: "练这道题",
        prompt: "从这道题开始模拟面试。先只提问，等我回答后再给反馈和追问。",
      },
      {
        label: "补回答结构",
        prompt: "结合我的真实材料，为这道题整理回答结构、证据和可能追问，不要编造事实。",
      },
    ],
    gap: [
      {
        label: "补这个缺口",
        prompt: "针对这个缺口，先告诉我需要补充哪些真实材料，再更新对应补强计划。",
      },
    ],
    debrief: [
      {
        label: "继续复盘",
        prompt: "继续分析这次真实面试，指出回答中最该改善的部分和下一轮练习重点。",
      },
      {
        label: "迭代准备计划",
        prompt: "只根据这次复盘更新对应岗位的补强计划，不自动修改其他材料。",
      },
    ],
  };
  return [...(byKind[target.kind] || []), ...common].slice(0, 4);
}

function currentSessionTarget() {
  const job = selectedJob();
  const report = selectedResearch();
  if (state.activeView === "research" && report) {
    return {
      kind: "research",
      title: `${report.company?.officialName || job?.company || "公司"}调研报告`,
      detail: job ? `${job.company} · ${job.title}` : "公司与面经",
      payload: { jobId: report.jobId, researchId: report.id },
    };
  }
  const resumeMatchesSelection =
    Boolean(state.resume.markdown) && state.resume.jobId === (job?.id || "");
  if (
    (state.activeView === "resumes" && state.resume.markdown) ||
    (state.activeView === "dashboard" && resumeMatchesSelection)
  ) {
    return {
      kind: "resume",
      title: state.resume.title || "当前简历",
      detail: job ? `${job.company} · ${job.title}` : "通用候选人简历",
      payload: { jobId: state.resume.jobId || "", resumeVersionId: state.resume.versionId || "" },
    };
  }
  if (state.workflowJobIds.length > 1) {
    const jobs = selectedWorkflowJobs();
    return {
      kind: "jobs",
      title: `${jobs.length} 个已选岗位`,
      detail: jobs.map((item) => `${item.company} · ${item.title}`).join("；"),
      payload: { jobIds: jobs.map((item) => item.id) },
    };
  }
  if (job) {
    return {
      kind: "job",
      title: `${job.company} · ${job.title}`,
      detail: `${job.source || "来源待确认"} · ${JD_COMPLETENESS_LABELS[normalizeJdCompleteness(job.jdCompleteness, job.description, true)]}`,
      payload: { jobId: job.id },
    };
  }
  return {
    kind: "panel",
    title: "当前求职面板",
    detail: "Agent 会读取当前项目、岗位和面板中的最新结构化数据。",
    payload: {},
  };
}

function renderSessionBridge() {
  const target = sessionBridgeContext;
  const kindLabels = {
    panel: "当前面板",
    jobs: "多个岗位",
    job: "目标岗位",
    research: "公司与面经",
    resume: "简历版本",
    question: "面试题",
    gap: "能力缺口",
    debrief: "真实复盘",
  };
  elements.sessionContextKind.textContent = kindLabels[target.kind] || "面板对象";
  elements.sessionContextTitle.textContent = target.title;
  elements.sessionContextDetail.textContent = target.detail;
  const actions = sessionActionsFor(target);
  elements.sessionQuickActions.replaceChildren(
    ...actions.map((action, index) => {
      const button = makeTextElement("button", "", action.label);
      button.type = "button";
      button.dataset.sessionQuickIndex = String(index);
      return button;
    }),
  );
  elements.sendSessionInstruction.disabled = Boolean(context.busy);
}

function openSessionBridge(target = currentSessionTarget(), suggestedPrompt = "") {
  const previousTarget = JSON.stringify([
    sessionBridgeContext.kind,
    sessionBridgeContext.payload,
  ]);
  const nextTarget = JSON.stringify([target.kind, target.payload]);
  sessionBridgeContext = target;
  renderSessionBridge();
  elements.sessionBridge.hidden = false;
  if (suggestedPrompt) {
    elements.sessionInstruction.value = suggestedPrompt;
  } else if (previousTarget !== nextTarget || !elements.sessionInstruction.value.trim()) {
    elements.sessionInstruction.value = sessionActionsFor(target)[0]?.prompt || "";
  }
  elements.sessionInstruction.focus();
}

function closeSessionBridge() {
  elements.sessionBridge.hidden = true;
}

function buildSessionBridgePrompt(instruction) {
  const target = sessionBridgeContext;
  const payload = JSON.stringify(target.payload);
  return [
    "请使用 job-hunt-hq:job-hunt-workflow skill 和 panel-app:job-hunt-hq 工具，继续处理我正在面板中查看的对象。",
    "先调用 get_job_search_context，读取当前项目中适用的 CODESHELL.md，并通过下面的不透明 ID 定位对象。",
    `对象类型：${target.kind}；对象标题：${target.title}；对象标识：${payload}`,
    `我的指令：${instruction}`,
    "只执行这条指令直接要求的任务，不自动扩展成固定全流程。需要结构化更新时用对应 Panel 工具写回；如果缺少真实事实，先在当前 Session 中向我询问，不要编造。",
  ].join("\n");
}

function persist({ quiet = true } = {}) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await hostCall("storage.set", { key: STORAGE_KEY, value: clone(state) });
      elements.lastSaved.textContent = "刚刚保存";
      if (!quiet) notify("已保存到求职面板");
    } catch (error) {
      notify(error instanceof Error ? error.message : "保存失败", "error");
    }
  }, 80);
}

function projectSnapshotPayload() {
  return {
    schemaVersion: 2,
    updatedAt: new Date().toISOString(),
    selectedJobId: state.selectedJobId,
    selectedInterviewSetId: state.selectedInterviewSetId,
    profile: clone(state.profile),
    jobs: clone(state.jobs),
    repos: clone(state.repos),
    experiences: clone(state.experiences),
    jobResearch: clone(state.jobResearch),
    workflowRuns: clone(state.workflowRuns),
    resume: clone(state.resume),
    versions: clone(state.versions),
    interviewSets: clone(state.interviewSets),
    preparationPlans: clone(state.preparationPlans),
    interviewDebriefs: clone(state.interviewDebriefs),
  };
}

async function writeProjectSnapshot() {
  if (!window.codeshellPanel?.call) return false;
  let expectedModifiedAt = null;
  let expectedRevision;
  try {
    const existing = await hostCall("workspace.readText", { path: PROJECT_STATE_PATH });
    expectedModifiedAt = existing.modifiedAt;
    expectedRevision = existing.revision;
  } catch {
    expectedModifiedAt = null;
  }
  try {
    const result = await hostCall("workspace.writeText", {
      path: PROJECT_STATE_PATH,
      content: `${JSON.stringify(projectSnapshotPayload(), null, 2)}\n`,
      expectedModifiedAt,
      ...(expectedRevision ? { expectedRevision } : {}),
    });
    projectContext.hasSnapshot = true;
    projectContext.lastSyncedAt = new Date().toISOString();
    projectContext.snapshotRevision = result?.revision || "";
    return true;
  } catch {
    return false;
  }
}

async function syncProjectContext({ quiet = true } = {}) {
  try {
    const [info, listing] = await Promise.all([
      hostCall("workspace.info", {}),
      hostCall("workspace.list", { path: "." }),
    ]);
    const entries = listing?.entries ?? [];
    projectContext.name = info?.name || context.cwd?.split(/[\\/]/).filter(Boolean).at(-1) || "当前项目";
    projectContext.hasCodeshellFile = entries.some(
      (entry) => String(entry.name || "").toLowerCase() === "codeshell.md",
    );
    try {
      const snapshot = await hostCall("workspace.readText", { path: PROJECT_STATE_PATH });
      const parsed = JSON.parse(snapshot.content);
      if (parsed?.schemaVersion === 1 || parsed?.schemaVersion === 2) {
        const migrated = mergeState(parsed);
        if (!Array.isArray(parsed.jobResearch)) migrated.jobResearch = [];
        if (!Array.isArray(parsed.workflowRuns)) migrated.workflowRuns = [];
        if (!Array.isArray(parsed.preparationPlans)) migrated.preparationPlans = [];
        if (!Array.isArray(parsed.interviewDebriefs)) migrated.interviewDebriefs = [];
        state = migrated;
        projectContext.hasSnapshot = true;
        projectContext.lastSyncedAt = parsed.updatedAt || "";
        projectContext.snapshotRevision = snapshot.revision || "";
      }
    } catch {
      projectContext.hasSnapshot = false;
      if (window.codeshellPanel?.call) state = emptyProjectState();
    }
    renderAll();
    if (!quiet) {
      notify(
        projectContext.hasSnapshot
          ? "已从当前项目重新读取岗位、JD、Resume 和面试题"
          : "已读取当前项目；Agent 生成内容后会自动写入面板",
      );
    }
  } catch (error) {
    if (!quiet) {
      notify(error instanceof Error ? error.message : "读取当前项目失败", "error");
    }
  }
}

function extractKeywords(job) {
  if (!job) return [];
  const text = `${job.title} ${job.description}`.toLowerCase();
  const found = KEYWORD_RULES.filter((rule) =>
    rule.tokens.some((token) => text.includes(token.toLowerCase())),
  );
  if (found.length >= 5) return found.slice(0, 10).map((rule) => rule.label);
  const fallback = ["业务理解", "交付质量", "问题解决", "团队协作"];
  return [...new Set([...found.map((rule) => rule.label), ...fallback])].slice(0, 8);
}

function evidenceText() {
  return [
    state.profile.role,
    state.profile.target,
    state.profile.summary,
    ...state.repos.flatMap((repo) => [repo.name, repo.tech, repo.summary]),
    ...state.experiences.flatMap((experience) => [
      experience.role,
      experience.company,
      ...(experience.achievements ?? []),
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

function keywordMatched(keyword) {
  const rule = KEYWORD_RULES.find((item) => item.label === keyword);
  const corpus = evidenceText();
  if (rule) return rule.tokens.some((token) => corpus.includes(token.toLowerCase()));
  return ["业务理解", "交付质量", "问题解决", "团队协作"].includes(keyword);
}

function calculateMatch(job) {
  const keywords = extractKeywords(job);
  if (!keywords.length) return 0;
  const matched = keywords.filter(keywordMatched).length;
  const evidenceScore = Math.round((matched / keywords.length) * 100);
  return Math.round((evidenceScore * 0.75 + Number(job.match || 70) * 0.25) / 1);
}

function renderView() {
  document.querySelectorAll(".view").forEach((view) => {
    const active = view.id === `view-${state.activeView}`;
    view.classList.toggle("active", active);
    view.hidden = !active;
  });
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewTarget === state.activeView);
  });
}

function renderWorkflowBuilder() {
  const availableIds = new Set(state.jobs.map((job) => job.id));
  state.workflowJobIds = state.workflowJobIds.filter((id) => availableIds.has(id));
  elements.workflowJobPicker.replaceChildren();
  if (!state.jobs.length) {
    elements.workflowJobPicker.append(
      makeTextElement("span", "workflow-picker-empty", "还没有岗位，可先只处理通用简历与材料。"),
    );
  } else {
    for (const job of state.jobs) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.workflowJobId = job.id;
      button.classList.toggle("active", state.workflowJobIds.includes(job.id));
      button.setAttribute("aria-pressed", String(state.workflowJobIds.includes(job.id)));
      button.append(
        makeTextElement("strong", "", job.company),
        makeTextElement("small", "", job.title),
      );
      elements.workflowJobPicker.append(button);
    }
  }

  elements.workflowTaskPicker
    .querySelectorAll("[data-workflow-task]")
    .forEach((button) => {
      const active = state.workflowTaskIds.includes(button.dataset.workflowTask);
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

  const jobs = selectedWorkflowJobs();
  const taskLabels = state.workflowTaskIds
    .map((id) => WORKFLOW_TASKS[id]?.label)
    .filter(Boolean);
  const jobSummary = jobs.length
    ? `${jobs.length} 个岗位`
    : "通用候选人材料（未选岗位）";
  elements.workflowSelectionSummary.textContent = taskLabels.length
    ? `${jobSummary} · ${taskLabels.join("、")}`
    : `${jobSummary} · 请选择至少一个任务`;
  elements.runCustomWorkflow.disabled = Boolean(context.busy) || taskLabels.length === 0;
}

function renderCounts() {
  const counts = {
    all: state.jobs.length,
    saved: state.jobs.filter((job) => job.status === "saved").length,
    tailoring: state.jobs.filter((job) => job.status === "tailoring").length,
    applied: state.jobs.filter((job) => job.status === "applied").length,
  };
  elements.jobNavCount.textContent = String(state.jobs.length);
  elements.sourceNavCount.textContent = context.cwd ? "1" : "0";
  elements.researchNavCount.textContent = String(state.jobResearch.length);
  elements.resumeNavCount.textContent = String(
    Math.max(state.versions.length, state.resume.markdown ? 1 : 0),
  );
  elements.interviewNavCount.textContent = String(
    state.interviewSets.length + state.interviewDebriefs.length,
  );
  elements.allCount.textContent = String(counts.all);
  elements.savedCount.textContent = String(counts.saved);
  elements.tailoringCount.textContent = String(counts.tailoring);
  elements.appliedCount.textContent = String(counts.applied);
  document.querySelectorAll("[data-status-filter]").forEach((button) => {
    button.classList.toggle("active-soft", button.dataset.statusFilter === state.statusFilter);
  });
}

function renderStats() {
  const average = state.jobs.length
    ? Math.round(state.jobs.reduce((sum, job) => sum + calculateMatch(job), 0) / state.jobs.length)
    : 0;
  const sourceParts = [
    Boolean(state.profile.summary),
    state.repos.length > 0,
    state.experiences.length > 0,
    state.repos.some((repo) => /\d/.test(repo.summary)),
  ];
  const completeness = Math.round(
    (sourceParts.filter(Boolean).length / Math.max(sourceParts.length, 1)) * 100,
  );
  const sourceCount = new Set(state.jobs.map((job) => normalizeSourceId(job.sourceId, job.source)))
    .size;
  elements.statJobs.textContent = String(state.jobs.length).padStart(2, "0");
  elements.statSourceDetail.textContent = sourceCount
    ? `来自 ${sourceCount} 个招聘渠道`
    : "等待导入职位";
  elements.statMatch.textContent = `${average}%`;
  elements.statSources.textContent = `${completeness}%`;
  if (state.resume.markdown && state.resume.jobId === state.selectedJobId) {
    elements.statNext.textContent = "继续精修";
    elements.statNextDetail.textContent = "核对事实与量化结果";
  } else {
    elements.statNext.textContent = "生成草稿";
    elements.statNextDetail.textContent = selectedJob() ? "为当前职位定制" : "先选择一个职位";
  }
}

function renderSourceFilter() {
  const activeSources = [...new Set(state.jobs.map((job) => job.sourceId || "other"))];
  const options = [
    { id: "all", label: "全部渠道" },
    ...activeSources
      .map((id) => ({
        id,
        label: providerLabel(id, state.jobs.find((job) => job.sourceId === id)?.source),
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "zh-CN")),
  ];
  elements.jobSourceFilter.replaceChildren(
    ...options.map((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.label;
      return option;
    }),
  );
  if (!options.some((item) => item.id === state.jobSourceFilter)) {
    state.jobSourceFilter = "all";
  }
  elements.jobSourceFilter.value = state.jobSourceFilter;
}

function jobsForCurrentFilter() {
  return state.jobs.filter((job) => {
    if (state.statusFilter !== "all" && job.status !== state.statusFilter) return false;
    if (state.jobFilter === "90" && calculateMatch(job) < 90) return false;
    if (
      state.jobSourceFilter !== "all" &&
      normalizeSourceId(job.sourceId, job.source) !== state.jobSourceFilter
    ) {
      return false;
    }
    return true;
  });
}

function makeTextElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function renderJobs() {
  renderSourceFilter();
  const jobs = jobsForCurrentFilter();
  elements.jobList.replaceChildren();
  for (const job of jobs) {
    const shell = document.createElement("article");
    shell.className = "job-card-shell";
    const card = document.createElement("button");
    card.type = "button";
    card.className = `job-card${job.id === state.selectedJobId ? " active" : ""}`;
    card.dataset.jobId = job.id;

    const top = document.createElement("div");
    top.className = "job-card-top";
    top.append(
      makeTextElement("span", "job-company", job.company),
      makeTextElement("span", "match-pill", `${calculateMatch(job)}%`),
    );

    const title = makeTextElement("h3", "", job.title);
    const meta = document.createElement("div");
    meta.className = "job-card-meta";
    meta.append(
      makeTextElement("span", "", job.location || "地点未注明"),
      makeTextElement("span", "", job.salary || "薪资面议"),
    );

    const bottom = document.createElement("div");
    bottom.className = "job-card-bottom";
    bottom.append(makeTextElement("span", "source-badge", job.source || "手动添加"));
    const badges = document.createElement("div");
    badges.className = "job-card-badges";
    const completeness = makeTextElement(
      "span",
      "jd-completeness-badge",
      JD_COMPLETENESS_LABELS[normalizeJdCompleteness(job.jdCompleteness, job.description, true)],
    );
    completeness.dataset.completeness = normalizeJdCompleteness(
      job.jdCompleteness,
      job.description,
      true,
    );
    const status = makeTextElement("span", "status-badge", STATUS_LABELS[job.status] || "已收藏");
    status.dataset.status = job.status;
    badges.append(completeness, status);
    bottom.append(badges);
    card.append(top, title, meta, bottom);
    const sessionButton = makeTextElement("button", "card-session-action", "问 Agent ↗");
    sessionButton.type = "button";
    sessionButton.dataset.sessionJobId = job.id;
    shell.append(card, sessionButton);
    elements.jobList.append(shell);
  }
  elements.emptyAddJob.hidden = jobs.length > 0;
}

function renderMarkdown(markdown) {
  elements.resumePreview.replaceChildren();
  elements.resumePreview.classList.toggle("empty", !markdown.trim());
  if (!markdown.trim()) {
    const inner = document.createElement("div");
    inner.className = "resume-empty-inner";
    inner.append(
      makeTextElement("span", "resume-empty-symbol", "✦"),
      makeTextElement("strong", "", "准备生成第一版"),
      makeTextElement(
        "p",
        "",
        "选择左侧职位，再点击“生成粗版”。你会得到一份可以继续编辑的 Markdown 简历。",
      ),
    );
    elements.resumePreview.append(inner);
    return;
  }

  const lines = markdown.split(/\r?\n/);
  let list = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      list = null;
      continue;
    }
    if (line.startsWith("# ")) {
      list = null;
      elements.resumePreview.append(makeTextElement("h1", "", line.slice(2)));
    } else if (line.startsWith("## ")) {
      list = null;
      elements.resumePreview.append(makeTextElement("h2", "", line.slice(3)));
    } else if (line.startsWith("### ")) {
      list = null;
      elements.resumePreview.append(makeTextElement("h3", "", line.slice(4)));
    } else if (/^[-*]\s/.test(line)) {
      if (!list) {
        list = document.createElement("ul");
        elements.resumePreview.append(list);
      }
      list.append(makeTextElement("li", "", line.replace(/^[-*]\s/, "")));
    } else {
      list = null;
      elements.resumePreview.append(makeTextElement("p", "", line));
    }
  }
}

function renderJobDescription(job) {
  elements.jdPreview.replaceChildren();
  elements.jdPreview.classList.toggle("empty", !job);
  if (!job) {
    const inner = document.createElement("div");
    inner.className = "resume-empty-inner";
    inner.append(
      makeTextElement("strong", "", "先选择一个岗位"),
      makeTextElement("p", "", "选择左侧岗位后，这里会展示完整 JD。"),
    );
    elements.jdPreview.append(inner);
    return;
  }
  const heading = document.createElement("header");
  heading.className = "jd-heading";
  heading.append(
    makeTextElement("h1", "", job.title),
    makeTextElement(
      "p",
      "jd-meta",
      `${job.company} · ${job.location || "地点未注明"} · ${job.salary || "薪资未注明"} · ${job.source || "来源未注明"}`,
    ),
  );
  elements.jdPreview.append(
    heading,
    makeTextElement(
      "h2",
      "",
      `职位描述 · ${JD_COMPLETENESS_LABELS[normalizeJdCompleteness(job.jdCompleteness, job.description, true)]}`,
    ),
    makeTextElement("p", "jd-description", job.description || "暂无完整 JD"),
  );
  if (job.verificationNotes) {
    elements.jdPreview.append(
      makeTextElement("p", "jd-verification-note", `核验说明：${job.verificationNotes}`),
    );
  }
}

function renderResume() {
  const job = selectedJob();
  const bound =
    state.resume.jobId === (job?.id || "") && Boolean(state.resume.markdown);
  elements.resumeTitle.textContent = bound
    ? state.resume.title
    : job
      ? `定制简历 · ${job.company}`
      : "通用简历 · 候选人基线";
  elements.resumeJobLabel.textContent = job
    ? `${job.company} / ${job.title}${job.sample ? " · 示例 JD" : ""}`
    : bound
      ? "通用版本 · 未绑定职位"
      : "尚未绑定职位";
  elements.resumeUpdated.textContent = bound && state.resume.updatedAt
    ? `更新于 ${formatDate(state.resume.updatedAt)}`
    : "未生成";
  elements.resumeEditor.value = bound ? state.resume.markdown : "";
  renderMarkdown(bound ? state.resume.markdown : "");
  renderJobDescription(job);
  const editing = resumeMode === "edit";
  const showingJd = resumeMode === "jd";
  elements.resumePreview.hidden = editing || showingJd;
  elements.resumeEditor.hidden = !editing;
  elements.jdPreview.hidden = !showingJd;
  document.querySelectorAll("[data-resume-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.resumeMode === resumeMode);
  });
  elements.saveResume.disabled = !bound;
  elements.generateResume.disabled = Boolean(context.busy);
  elements.continueResumeSession.disabled = !bound || Boolean(context.busy);
}

function renderInsights() {
  const job = selectedJob();
  const keywords = extractKeywords(job);
  const matches = keywords.filter(keywordMatched);
  elements.matchScore.textContent = job ? `${calculateMatch(job)}%` : "--";
  elements.keywordCount.textContent = `${keywords.length} 项`;
  elements.coverageLabel.textContent = `${matches.length} / ${keywords.length}`;
  elements.keywordList.replaceChildren();
  elements.coverageList.replaceChildren();
  elements.discussJobSession.disabled = !job || Boolean(context.busy);

  if (!job) {
    elements.keywordList.append(makeTextElement("span", "tag", "选择一个职位"));
    return;
  }

  for (const keyword of keywords) {
    const tag = makeTextElement("span", `tag${keywordMatched(keyword) ? " matched" : ""}`, keyword);
    elements.keywordList.append(tag);
  }

  const coverageRows = [
    { label: "工作经历", value: Math.min(100, state.experiences.length * 45 + 10) },
    { label: "Repo 证据", value: Math.min(100, state.repos.length * 38 + 12) },
    {
      label: "JD 关键词",
      value: keywords.length ? Math.round((matches.length / keywords.length) * 100) : 0,
    },
    { label: "量化结果", value: evidenceText().match(/\d+/g)?.length ? 72 : 22 },
  ];
  for (const row of coverageRows) {
    const item = document.createElement("div");
    item.className = "coverage-item";
    const track = document.createElement("progress");
    track.className = "coverage-track";
    track.max = 100;
    track.value = row.value;
    track.setAttribute("aria-label", `${row.label} ${row.value}%`);
    item.append(makeTextElement("span", "", row.label), track);
    elements.coverageList.append(item);
  }
  elements.openSourceJob.disabled = !job.url;
  elements.advanceJob.disabled = !job;
  elements.advanceJob.textContent = job.status === "applied" ? "已标记为投递" : "标记为已投递";
}

function renderMaterials() {
  elements.projectContextName.textContent = projectContext.name;
  elements.projectContextState.textContent = context.cwd ? "已绑定" : "未绑定";
  elements.codeshellFileState.textContent = projectContext.hasCodeshellFile
    ? "已发现"
    : "未发现";
  elements.projectSnapshotState.textContent = projectContext.hasSnapshot
    ? `已同步${projectContext.lastSyncedAt ? ` · ${formatDate(projectContext.lastSyncedAt)}` : ""}`
    : "Agent 首次写回后创建";
  elements.sideProfileName.textContent = state.profile.name;
  elements.sideProfileRole.textContent = state.profile.role;
  elements.profileName.value = state.profile.name;
  elements.profileRole.value = state.profile.role;
  elements.profileContact.value = state.profile.contact;
  elements.profileTarget.value = state.profile.target;
  elements.profileSummary.value = state.profile.summary;
  elements.repoCount.textContent = String(state.repos.length).padStart(2, "0");
  elements.experienceCount.textContent = String(state.experiences.length).padStart(2, "0");

  elements.repoList.replaceChildren();
  for (const repo of state.repos) {
    const item = document.createElement("article");
    item.className = "material-item";
    item.append(
      makeTextElement("strong", "", repo.name),
      makeTextElement(
        "span",
        "material-item-meta",
        `${repo.tech || "技术栈待补充"} · ${repo.path || "本地项目"}`,
      ),
      makeTextElement("p", "", repo.summary),
    );
    elements.repoList.append(item);
  }

  elements.experienceList.replaceChildren();
  for (const experience of state.experiences) {
    const item = document.createElement("article");
    item.className = "material-item";
    item.append(
      makeTextElement("strong", "", `${experience.company} · ${experience.role}`),
      makeTextElement("span", "material-item-meta", experience.period || "时间待补充"),
      makeTextElement("p", "", (experience.achievements || []).join("；")),
    );
    elements.experienceList.append(item);
  }
}

function renderVersions() {
  elements.resumeVersionList.replaceChildren();
  const versions = [...state.versions];
  if (state.resume.markdown && !versions.some((version) => version.id === state.resume.versionId)) {
    versions.unshift({
      id: state.resume.versionId || "current",
      jobId: state.resume.jobId,
      title: state.resume.title,
      markdown: state.resume.markdown,
      updatedAt: state.resume.updatedAt,
    });
  }
  if (!versions.length) {
    const empty = document.createElement("article");
    empty.className = "resume-version-card";
    empty.append(
      makeTextElement("span", "panel-kicker", "NO DRAFTS YET"),
      makeTextElement("h2", "", "还没有简历版本"),
      makeTextElement("p", "", "回到机会面板，选择职位并生成第一份定制草稿。"),
    );
    elements.resumeVersionList.append(empty);
    return;
  }
  for (const [index, version] of versions.entries()) {
    const job = state.jobs.find((item) => item.id === version.jobId);
    const card = document.createElement("article");
    card.className = `resume-version-card${index === 0 ? " current" : ""}`;
    const header = document.createElement("header");
    header.append(
      makeTextElement("span", "panel-kicker", index === 0 ? "CURRENT VERSION" : "ARCHIVED"),
      makeTextElement("span", "tiny-badge", formatDate(version.updatedAt)),
    );
    const mini = document.createElement("div");
    mini.className = "mini-paper";
    mini.append(
      document.createElement("i"),
      document.createElement("span"),
      document.createElement("span"),
      document.createElement("span"),
    );
    card.append(
      header,
      makeTextElement("h2", "", version.title || "未命名简历"),
      makeTextElement("p", "", job ? `${job.company} · ${job.title}` : "职位信息待关联"),
      mini,
    );
    const continueButton = makeTextElement("button", "card-session-action", "在 Session 继续 ↗");
    continueButton.type = "button";
    continueButton.dataset.sessionResumeVersionId = version.id;
    card.append(continueButton);
    elements.resumeVersionList.append(card);
  }
}

function renderInterviewLoop() {
  const job = selectedJob();
  const plan = selectedPreparationPlan();
  const debriefs = state.interviewDebriefs
    .filter((item) => (job ? item.jobId === job.id : !item.jobId))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));

  elements.preparationTitle.textContent =
    plan?.title || (job ? `${job.company} · 等待补强计划` : "通用候选人补强计划");
  elements.preparationSummary.textContent =
    plan?.summary ||
    "让 Agent 对照真实材料识别已有优势、证据缺口、简历修改项和下一步练习。";
  renderTagItems(
    elements.preparationStrengths,
    plan?.strengths,
    job ? "优势待分析" : "可先生成通用优势清单",
  );

  elements.preparationGapList.replaceChildren();
  for (const [gapIndex, gap] of (plan?.gaps || []).entries()) {
    const card = document.createElement("article");
    card.className = "preparation-gap";
    const header = document.createElement("header");
    const priority = makeTextElement(
      "span",
      "preparation-priority",
      { high: "优先补", medium: "随后补", low: "观察" }[gap.priority] || "待安排",
    );
    priority.dataset.priority = gap.priority || "medium";
    const actions = document.createElement("div");
    actions.className = "context-card-actions";
    const sessionButton = makeTextElement("button", "inline-session-action", "补这个 ↗");
    sessionButton.type = "button";
    sessionButton.dataset.sessionGapIndex = String(gapIndex);
    actions.append(priority, sessionButton);
    header.append(makeTextElement("strong", "", gap.area || "能力缺口"), actions);
    const details = [gap.evidence, gap.impact].filter(Boolean).join(" ");
    card.append(
      header,
      makeTextElement("p", "", details || "等待补充证据和影响。"),
    );
    if (gap.actions?.length) {
      card.append(makeTextElement("p", "", `行动：${gap.actions.join("；")}`));
    }
    if (gap.practice) {
      card.append(makeTextElement("p", "", `练习：${gap.practice}`));
    }
    elements.preparationGapList.append(card);
  }
  if (!plan?.gaps?.length) {
    elements.preparationGapList.append(
      makeTextElement("div", "interview-loop-empty", "还没有保存能力缺口。"),
    );
  }

  elements.preparationActionList.replaceChildren();
  for (const action of plan?.nextActions || []) {
    const card = document.createElement("article");
    card.className = "preparation-action";
    const header = document.createElement("header");
    const priority = makeTextElement(
      "span",
      "preparation-priority",
      { high: "高", medium: "中", low: "低" }[action.priority] || "待定",
    );
    priority.dataset.priority = action.priority || "medium";
    header.append(makeTextElement("strong", "", action.title || "下一步"), priority);
    card.append(header, makeTextElement("p", "", action.detail || action.kind || "待补充"));
    elements.preparationActionList.append(card);
  }

  elements.debriefCount.textContent = `${debriefs.length} 次`;
  elements.interviewDebriefList.replaceChildren();
  for (const debrief of debriefs) {
    const card = document.createElement("article");
    card.className = "interview-debrief-item";
    const header = document.createElement("header");
    const outcomeLabels = {
      pending: "等待结果",
      pass: "通过",
      reject: "未通过",
      unknown: "未知",
    };
    const outcome = makeTextElement(
      "span",
      "debrief-outcome",
      outcomeLabels[debrief.outcome] || "未知",
    );
    outcome.dataset.outcome = debrief.outcome || "unknown";
    const actions = document.createElement("div");
    actions.className = "context-card-actions";
    const sessionButton = makeTextElement("button", "inline-session-action", "继续 ↗");
    sessionButton.type = "button";
    sessionButton.dataset.sessionDebriefId = debrief.id;
    actions.append(outcome, sessionButton);
    header.append(makeTextElement("strong", "", debrief.round || "面试记录"), actions);
    card.append(
      header,
      makeTextElement("p", "", debrief.summary || "暂无复盘摘要"),
      makeTextElement(
        "p",
        "",
        `${debrief.questions?.length || 0} 个问题 · ${formatDate(debrief.interviewedAt || debrief.createdAt)}`,
      ),
    );
    elements.interviewDebriefList.append(card);
  }
  if (!debriefs.length) {
    elements.interviewDebriefList.append(
      makeTextElement(
        "div",
        "interview-loop-empty",
        job ? "这个岗位还没有真实面试记录。" : "选择岗位后查看对应复盘。",
      ),
    );
  }

  elements.refreshPreparationPlan.disabled = Boolean(context.busy);
  elements.startInterviewDebrief.disabled = Boolean(context.busy);
}

function renderInterviews() {
  renderInterviewLoop();
  elements.interviewSetCount.textContent = String(state.interviewSets.length).padStart(2, "0");
  elements.interviewSetList.replaceChildren();

  for (const set of state.interviewSets) {
    const job = state.jobs.find((item) => item.id === set.jobId);
    const card = document.createElement("button");
    card.type = "button";
    card.className = `interview-set-card${set.id === state.selectedInterviewSetId ? " active" : ""}`;
    card.dataset.interviewSetId = set.id;
    card.append(
      makeTextElement("span", "panel-kicker", INTERVIEW_MODE_LABELS[set.mode] || "定制面试"),
      makeTextElement("strong", "", set.title || `${job?.company || "目标岗位"} · 面试题`),
      makeTextElement(
        "span",
        "material-item-meta",
        `${set.questions?.length || 0} 题 · ${formatDate(set.createdAt)}`,
      ),
    );
    elements.interviewSetList.append(card);
  }

  const set = selectedInterviewSet();
  const job = set ? state.jobs.find((item) => item.id === set.jobId) : null;
  const questions = Array.isArray(set?.questions) ? set.questions : [];
  const categories = [...new Set(questions.map((item) => item.category).filter(Boolean))];
  const evidenceRefs = new Set(questions.flatMap((item) => item.evidenceRefs || []));

  elements.interviewJobLabel.textContent = job
    ? `${job.company} / ${job.title}${job.sample ? " · 示例 JD" : ""}`
    : "选择职位后生成专属题单";
  elements.interviewSetTitle.textContent = set?.title || "还没有面试题单";
  elements.interviewQuestionCount.textContent = String(questions.length).padStart(2, "0");
  elements.interviewEvidenceCount.textContent = String(evidenceRefs.size).padStart(2, "0");
  elements.interviewCategoryCount.textContent = String(categories.length).padStart(2, "0");
  elements.simulateInterview.disabled = !set || Boolean(context.busy);
  elements.regenerateInterview.disabled = !job || Boolean(context.busy);

  const filterOptions = ["全部", ...categories];
  if (!filterOptions.includes(state.interviewCategoryFilter)) {
    state.interviewCategoryFilter = "全部";
  }
  elements.interviewCategoryFilters.replaceChildren(
    ...filterOptions.map((category) => {
      const button = makeTextElement("button", "interview-filter", category);
      button.type = "button";
      button.dataset.interviewCategory = category;
      button.classList.toggle("active", category === state.interviewCategoryFilter);
      return button;
    }),
  );

  const visibleQuestions = questions.filter(
    (item) =>
      state.interviewCategoryFilter === "全部" || item.category === state.interviewCategoryFilter,
  );
  elements.interviewQuestionList.replaceChildren();

  if (!visibleQuestions.length) {
    const empty = document.createElement("article");
    empty.className = "interview-empty";
    const inner = document.createElement("div");
    inner.append(
      makeTextElement("strong", "", "先生成一套岗位定制面试题"),
      makeTextElement(
        "p",
        "",
        "系统会把 JD、工作经历和 Repo 证据交叉起来，覆盖技术、项目、系统设计、行为与材料缺口。",
      ),
    );
    empty.append(inner);
    elements.interviewQuestionList.append(empty);
    return;
  }

  for (const [index, question] of visibleQuestions.entries()) {
    const card = document.createElement("article");
    card.className = "question-card";

    const top = document.createElement("div");
    top.className = "question-card-top";
    const meta = document.createElement("div");
    meta.className = "question-meta";
    meta.append(
      makeTextElement("span", "question-category", question.category || "岗位问题"),
      makeTextElement("span", "question-difficulty", question.difficulty || "进阶"),
    );
    const practiceButton = makeTextElement("button", "inline-session-action", "练这道 ↗");
    practiceButton.type = "button";
    practiceButton.dataset.sessionQuestionId = question.id;
    meta.append(practiceButton);
    top.append(
      makeTextElement("span", "question-index", `Q${String(index + 1).padStart(2, "0")}`),
      meta,
    );

    const why = document.createElement("p");
    why.className = "question-why";
    why.append(
      makeTextElement("span", "question-why-label", "为什么会问"),
      document.createTextNode(question.why),
    );

    const evidence = document.createElement("div");
    evidence.className = "question-evidence";
    const refs = question.evidenceRefs?.length ? question.evidenceRefs : ["JD · 待补充证据"];
    evidence.append(...refs.map((item) => makeTextElement("span", "evidence-chip", item)));

    const answer = document.createElement("details");
    answer.className = "answer-points";
    answer.append(makeTextElement("summary", "", "查看回答要点与可能追问"));
    const answerTitle = makeTextElement("strong", "", "回答要点");
    const answerList = document.createElement("ul");
    answerList.append(
      ...(question.answerPoints?.length
        ? question.answerPoints
        : ["先讲场景与目标", "说明自己的动作与取舍", "以真实结果或复盘收尾"]
      ).map((item) => makeTextElement("li", "", item)),
    );
    answer.append(answerTitle, answerList);
    if (question.followUps?.length) {
      answer.append(makeTextElement("strong", "", "可能追问"));
      const followUpList = document.createElement("ul");
      followUpList.append(...question.followUps.map((item) => makeTextElement("li", "", item)));
      answer.append(followUpList);
    }

    card.append(top, makeTextElement("h3", "", question.question), why, evidence, answer);
    elements.interviewQuestionList.append(card);
  }
}

function selectedResearch() {
  return state.jobResearch.find((report) => report.jobId === state.selectedJobId) ?? null;
}

function renderTagItems(container, items, emptyLabel) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  container.replaceChildren(
    ...(values.length ? values : [emptyLabel]).map((item) =>
      makeTextElement("span", `tag${values.length ? " matched" : ""}`, item),
    ),
  );
}

function renderResearch() {
  const latestRun = state.workflowRuns[0] ?? null;
  elements.runCompanyResearch.disabled = Boolean(context.busy) || !selectedJob();
  elements.continueResearchSession.disabled =
    Boolean(context.busy) || !selectedResearch();
  const workflowLabels = {
    running: "调研进行中",
    completed: "最近流程已完成",
    partial: "部分完成",
    failed: "最近流程失败",
  };
  elements.workflowStatus.textContent = latestRun
    ? workflowLabels[latestRun.status] || latestRun.status
    : "尚未运行";
  elements.workflowStatus.classList.toggle("running", latestRun?.status === "running");
  elements.researchReportCount.textContent = `${state.jobResearch.length} 份`;
  elements.researchReportList.replaceChildren();

  for (const report of state.jobResearch) {
    const job = state.jobs.find((item) => item.id === report.jobId);
    const card = document.createElement("button");
    card.type = "button";
    card.className = `research-report-card${report.jobId === state.selectedJobId ? " active" : ""}`;
    card.dataset.researchJobId = report.jobId;
    card.append(
      makeTextElement("span", "panel-kicker", report.sample ? "SAMPLE RESEARCH" : "SOURCED REPORT"),
      makeTextElement("strong", "", report.company?.officialName || job?.company || "公司待确认"),
      makeTextElement("span", "", job?.title || "岗位待关联"),
      makeTextElement(
        "small",
        "",
        `${report.reviews?.length || 0} 条评价 · ${report.sources?.length || 0} 个来源`,
      ),
    );
    elements.researchReportList.append(card);
  }

  if (!state.jobResearch.length) {
    const empty = document.createElement("div");
    empty.className = "research-list-empty";
    empty.append(
      makeTextElement("strong", "", "还没有调研报告"),
      makeTextElement("span", "", "在当前 Session 里说“调研当前公司”即可。"),
    );
    elements.researchReportList.append(empty);
  }

  const report = selectedResearch();
  const job = selectedJob();
  elements.researchEmpty.hidden = Boolean(report);
  elements.researchContent.hidden = !report;
  elements.researchCompanySite.disabled = !report?.company?.website;
  elements.researchCareersSite.disabled = !report?.company?.careersUrl;
  elements.researchCompanySite.dataset.externalUrl = report?.company?.website || "";
  elements.researchCareersSite.dataset.externalUrl = report?.company?.careersUrl || "";
  elements.researchJobLabel.textContent = job
    ? `${job.company} / ${job.title}${job.sample ? " · 示例" : ""}`
    : "尚未绑定岗位";
  elements.researchTitle.textContent = report
    ? `${report.company?.officialName || job?.company || "公司"} 调研报告`
    : "等待 Agent 完成公司调研";
  elements.researchUpdated.textContent = report ? formatDate(report.updatedAt) : "未生成";
  if (!report) return;

  const company = report.company ?? {};
  elements.companySummary.textContent = company.summary || "暂无可核验的公司简介。";
  const facts = [
    ["行业", company.industry],
    ["阶段", company.stage],
    ["规模", company.size],
    ["地点", company.locations?.join("、")],
  ].filter(([, value]) => value);
  elements.companyFacts.replaceChildren(
    ...facts.map(([label, value]) => {
      const row = document.createElement("div");
      row.append(makeTextElement("span", "", label), makeTextElement("strong", "", value));
      return row;
    }),
  );
  renderTagItems(elements.companyProducts, company.products, "产品信息待补充");
  renderTagItems(
    elements.companyTech,
    [...(company.techSignals || []), ...(company.hiringSignals || [])],
    "技术信号待补充",
  );

  elements.companyReviews.replaceChildren();
  for (const review of report.reviews || []) {
    const card = document.createElement("article");
    card.className = "review-card";
    const header = document.createElement("header");
    header.append(
      makeTextElement("strong", "", review.title || review.source || "公开评价"),
      makeTextElement("span", `sentiment ${review.sentiment || "unknown"}`, review.sentiment || "unknown"),
    );
    const pros = document.createElement("div");
    pros.className = "review-points";
    if (review.pros?.length) {
      pros.append(
        makeTextElement("b", "", "正向"),
        makeTextElement("span", "", review.pros.join("；")),
      );
    }
    if (review.cons?.length) {
      pros.append(
        makeTextElement("b", "", "风险"),
        makeTextElement("span", "", review.cons.join("；")),
      );
    }
    const footer = document.createElement("footer");
    footer.append(
      makeTextElement(
        "span",
        "",
        `${review.source || "来源待确认"} · 可信度 ${review.confidence || "low"}`,
      ),
    );
    if (review.url) {
      const sourceButton = makeTextElement("button", "source-link-button", "查看来源 ↗");
      sourceButton.type = "button";
      sourceButton.dataset.externalUrl = review.url;
      footer.append(sourceButton);
    }
    card.append(header, makeTextElement("p", "", review.summary || "暂无摘要"), pros, footer);
    elements.companyReviews.append(card);
  }
  if (!report.reviews?.length) {
    elements.companyReviews.append(makeTextElement("p", "research-muted", "未找到可公开访问的评价。"));
  }

  const intel = report.interviewIntel ?? {};
  elements.interviewIntelSummary.textContent =
    intel.summary || "暂未找到可核验的公开面试情报。";
  elements.interviewProcess.replaceChildren(
    ...(intel.process?.length ? intel.process : ["流程待核验"]).map((item) =>
      makeTextElement("li", "", item),
    ),
  );
  renderTagItems(elements.interviewThemes, intel.themes, "主题待补充");
  elements.reportedQuestions.replaceChildren();
  for (const question of intel.questions || []) {
    const card = document.createElement("article");
    const origin = question.origin === "reported" ? "公开面经" : "根据 JD 预测";
    card.append(
      makeTextElement("span", "question-category", question.category || "岗位问题"),
      makeTextElement("h4", "", question.question),
      makeTextElement("small", "", origin),
    );
    if (question.sourceUrl) {
      const sourceButton = makeTextElement("button", "source-link-button", "来源 ↗");
      sourceButton.type = "button";
      sourceButton.dataset.externalUrl = question.sourceUrl;
      card.append(sourceButton);
    }
    elements.reportedQuestions.append(card);
  }
  if (!intel.questions?.length) {
    elements.reportedQuestions.append(
      makeTextElement("p", "research-muted", "没有保存公开问题或预测题。"),
    );
  }

  elements.researchRisks.replaceChildren(
    ...(report.risks?.length ? report.risks : ["暂无已记录风险"]).map((item) =>
      makeTextElement("li", "", item),
    ),
  );
  elements.researchSources.replaceChildren();
  for (const source of report.sources || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "research-source-card";
    button.dataset.externalUrl = source.url;
    button.disabled = !source.url;
    button.append(
      makeTextElement("span", "source-kind", source.kind || "other"),
      makeTextElement("strong", "", source.title || source.publisher || "来源"),
      makeTextElement(
        "small",
        "",
        `${source.publisher || "发布者待确认"}${source.publishedAt ? ` · ${source.publishedAt}` : ""}`,
      ),
    );
    elements.researchSources.append(button);
  }
  if (!report.sources?.length) {
    elements.researchSources.append(makeTextElement("p", "research-muted", "暂无来源记录。"));
  }
}

function renderAll() {
  if (elements.sessionBridge.hidden) sessionBridgeContext = currentSessionTarget();
  renderView();
  renderWorkflowBuilder();
  renderCounts();
  renderStats();
  renderJobs();
  renderResume();
  renderInsights();
  renderMaterials();
  renderResearch();
  renderVersions();
  renderInterviews();
  renderSessionBridge();
}

function composeDraft(job) {
  const keywords = job ? extractKeywords(job) : [];
  const matched = keywords.filter(keywordMatched);
  const experienceSections = state.experiences
    .map((experience) => {
      const bullets = (experience.achievements || []).map((item) => `- ${item}`).join("\n");
      return `### ${experience.company} · ${experience.role}\n${experience.period || ""}\n${bullets}`;
    })
    .join("\n\n");
  const repoSections = state.repos
    .map(
      (repo) =>
        `### ${repo.name}\n${repo.tech || "技术栈待补充"}\n- ${repo.summary}${repo.path ? `\n- Repo：${repo.path}` : ""}`,
    )
    .join("\n\n");

  return [
    `# ${state.profile.name || "你的姓名"}`,
    `${state.profile.role || "目标角色"} · ${state.profile.contact || "联系方式待补充"}`,
    "",
    "## 专业概述",
    job
      ? `${state.profile.summary || "请补充职业简介"} 针对 ${job.company} 的「${job.title}」机会，重点呈现 ${matched.slice(0, 4).join("、") || "相关产品与工程能力"}。`
      : state.profile.summary || "请补充职业简介与目标方向。",
    "",
    "## 核心能力",
    matched.length
      ? matched.map((keyword) => `- ${keyword}`).join("\n")
      : "- 请根据职位要求补充对应能力证据",
    "",
    "## 工作经历",
    experienceSections || "### 待补充\n- 请先在材料库添加真实工作经历。",
    "",
    "## 项目与代码",
    repoSections || "### 待补充\n- 请先在材料库添加 Repo 或项目成果。",
    "",
    "## 定制说明",
    job ? `- 目标职位：${job.company} · ${job.title}` : "- 当前版本：通用候选人基线",
    job
      ? `- 已覆盖关键词：${matched.join("、") || "待核对"}`
      : `- 目标方向：${state.profile.target || "待补充"}`,
    job
      ? `- 待补强：${keywords.filter((keyword) => !matched.includes(keyword)).join("、") || "请补充更多可量化结果"}`
      : "- 待补强：请补充可核验的影响范围、量化结果与项目证据",
  ].join("\n");
}

function archiveCurrentResume() {
  if (!state.resume.markdown) return;
  const version = {
    id: state.resume.versionId || uid("resume"),
    jobId: state.resume.jobId,
    title: state.resume.title,
    markdown: state.resume.markdown,
    notes: state.resume.notes || [],
    updatedAt: state.resume.updatedAt,
  };
  state.versions = [version, ...state.versions.filter((item) => item.id !== version.id)].slice(
    0,
    12,
  );
}

function generateLocalDraft() {
  const job = selectedJob();
  const jobId = job?.id || "";
  if (state.resume.markdown && state.resume.jobId !== jobId) archiveCurrentResume();
  if (job) job.status = "tailoring";
  const now = new Date().toISOString();
  state.resume = {
    jobId,
    versionId: uid("resume"),
    title: job ? `${job.company} · ${job.title}` : "通用候选人简历",
    markdown: composeDraft(job),
    notes: ["请核对所有事实与日期", "建议补充至少一个可量化结果"],
    updatedAt: now,
  };
  resumeMode = "preview";
  persist();
  renderAll();
  notify("粗版简历已生成，可以直接切到“编辑”继续修改");
}

async function generateDraft() {
  const job = selectedJob();
  if (!window.codeshellPanel?.call) {
    generateLocalDraft();
    return;
  }
  const prompt = [
    "请使用 job-hunt-hq:job-hunt-workflow skill 和 panel-app:job-hunt-hq 工具生成一份可编辑的粗版简历。",
    job ? `目标职位 ID：${job.id}` : "本次不绑定岗位，生成通用候选人基线简历。",
    "先调用 get_job_search_context 读取 JD 与项目上下文；项目中有 CODESHELL.md 时按它检查工作经历、项目说明、代码和其他候选人资料。",
    "若识别到候选人资料变化，调用 save_candidate_context 更新面板中的项目上下文。",
    "仅使用当前项目中能核实的事实；不要编造公司、日期、职责、技术或数字。对无法确认的信息放进 notes。",
    "完成后必须调用 save_resume_draft，把完整 Markdown 写回面板。",
  ].join("\n");
  try {
    await hostCall("agent.submitPrompt", { prompt });
    notify("Agent 正在读取当前项目并生成简历，完成后会自动显示");
  } catch (error) {
    notify(error instanceof Error ? error.message : "提交简历生成失败", "error");
  }
}

async function saveResumeToRepo() {
  const job = selectedJob();
  if (!state.resume.markdown || state.resume.jobId !== (job?.id || "")) {
    return notify("当前视图还没有可保存的简历", "error");
  }
  const path = job
    ? `job-hunt-resume-${slugify(`${job.company}-${job.title}`)}.md`
    : "job-hunt-resume-current.md";
  let expectedModifiedAt = null;
  let expectedRevision;
  try {
    const existing = await hostCall("workspace.readText", { path });
    expectedModifiedAt = existing.modifiedAt;
    expectedRevision = existing.revision;
  } catch {
    expectedModifiedAt = null;
  }
  try {
    await hostCall("workspace.writeText", {
      path,
      content: state.resume.markdown,
      expectedModifiedAt,
      ...(expectedRevision ? { expectedRevision } : {}),
    });
    notify(`已保存到 ${path}`);
  } catch (error) {
    notify(error instanceof Error ? error.message : "保存到 Repo 失败", "error");
  }
}

function openDialog(id) {
  const dialog = document.querySelector(`#${id}`);
  if (dialog instanceof HTMLDialogElement) dialog.showModal();
}

function closeDialog(id) {
  const dialog = document.querySelector(`#${id}`);
  if (dialog instanceof HTMLDialogElement) dialog.close();
}

async function submitJobSearch(form) {
  if (context.busy) return notify("当前 Agent 正在运行，请稍后再试", "error");
  const data = new FormData(form);
  const keyword = String(data.get("keyword") || "").trim();
  const city = String(data.get("city") || "").trim();
  const seniority = String(data.get("seniority") || "").trim();
  const count = Number(data.get("count") || 5);
  const providerIds = data
    .getAll("providers")
    .map((value) => String(value))
    .filter((id) => PROVIDER_BY_ID.has(id));
  if (!providerIds.length) return notify("至少选择一个招聘渠道", "error");
  const providers = providerIds.map((id) => PROVIDER_BY_ID.get(id));
  const providerSummary = providers
    .map((provider) => `${provider.label}（${provider.domain}）`)
    .join("、");
  const prompt = [
    "请使用 job-hunt-hq:job-hunt-workflow Skill，在当前 Session 里完成一次轻量岗位发现。",
    `帮我从 ${providerSummary} 找最多 ${count} 个当前岗位。`,
    `条件：关键词「${keyword || "从项目资料和面板推断"}」，城市「${city || "不限"}」，经验「${seniority || "不限"}」。`,
    "先读取面板和当前项目上下文，再开始搜索。先把能核实的岗位保存到面板；JD 不完整时标为 listing_only 或 partial，后续在同一条记录上补全。",
    "只做岗位发现，不自动扩展到公司调研、简历或面试题。不要编造，也不要导出或在浏览器外复用招聘网站的登录凭据。",
  ].join("\n");

  try {
    await hostCall("agent.submitPrompt", { prompt });
    closeDialog("agent-dialog");
    notify(
      window.codeshellPanel?.call
        ? "已交给 Agent，找到的职位会写回机会面板"
        : "浏览器预览不会真实抓取；安装到 CodeShell 后会交给 Agent",
    );
  } catch (error) {
    notify(error instanceof Error ? error.message : "提交职位搜索失败", "error");
  }
}

async function submitResumeRevision(request) {
  const job = selectedJob();
  const prompt = [
    "请使用 job-hunt-hq:job-hunt-workflow skill 和 panel-app:job-hunt-hq 工具调整当前简历。",
    job ? `目标职位 ID：${job.id}` : "本次不绑定岗位，调整通用候选人基线简历。",
    "先调用 get_job_search_context；项目中有 CODESHELL.md 时按它读取相关资料，再逐条核对 JD 与项目证据。",
    "若识别到新的候选人资料，先调用 save_candidate_context 更新面板。只使用能核实的真实信息，不要编造公司、日期、技术、职责或数据。",
    "完成后必须调用 save_resume_draft，把完整 Markdown 写回面板。",
    `我的调整要求：${request}`,
  ].join("\n");
  try {
    await hostCall("agent.submitPrompt", { prompt });
    closeDialog("resume-agent-dialog");
    notify(
      window.codeshellPanel?.call
        ? "Agent 已开始调整，完成后新草稿会写回这里"
        : "浏览器预览不会调用 Agent；安装到 CodeShell 后可使用此功能",
    );
  } catch (error) {
    notify(error instanceof Error ? error.message : "提交调整失败", "error");
  }
}

function buildInterviewQuestions(job, options) {
  const difficulty = options.difficulty || "进阶";
  const keywords = extractKeywords(job);
  const unmatched = keywords.filter((keyword) => !keywordMatched(keyword));
  const focusSuffix = options.focus ? `，并结合「${options.focus}」` : "";
  const questions = [];
  const add = (category, question, why, evidenceRefs, answerPoints, followUps) => {
    questions.push({
      id: uid("question"),
      category,
      difficulty,
      question,
      why,
      evidenceRefs,
      answerPoints,
      followUps,
    });
  };

  for (const repo of state.repos) {
    add(
      "项目深挖",
      `请用 3 分钟介绍 ${repo.name}：你负责的核心范围是什么，最难的技术或产品决策是什么${focusSuffix}？`,
      `这个项目与 ${job.title} 的能力要求存在交集，面试官会验证你是否真正参与了关键决策。`,
      [`Repo · ${repo.name}`, `JD · ${keywords.slice(0, 2).join(" / ") || job.title}`],
      ["从问题、约束、个人职责开始", "解释方案选择与被放弃的方案", "用真实结果或复盘结束"],
      ["如果重做一次，你会改变哪项设计？", "哪一部分最能证明是你本人完成的？"],
    );
    add(
      "项目深挖",
      `${repo.name} 使用了 ${repo.tech || "多项技术"}。请选择一个关键模块，说明数据流、错误处理和可维护性设计。`,
      "Repo 材料里有技术栈和项目摘要，适合继续追问实现细节与工程判断。",
      [`Repo · ${repo.name}`, repo.path ? `代码位置 · ${repo.path}` : "Repo · 技术实现"],
      ["画清模块边界与数据流", "说明异常、降级和可观测性", "交代测试方式和长期维护成本"],
      ["高并发或大数据量下，哪个环节先出现瓶颈？"],
    );
  }

  for (const experience of state.experiences) {
    const achievement = experience.achievements?.[0] || "负责的重要项目";
    add(
      "经历复盘",
      `在 ${experience.company} 担任 ${experience.role} 时，你提到“${achievement}”。请说明目标、你的具体动作和最终影响。`,
      "这道题把简历描述展开成可核验的 STAR 证据，避免回答停留在团队层面。",
      [`工作经历 · ${experience.company}`, `职位 · ${experience.role}`],
      ["区分团队成果与个人贡献", "补充时间、规模和约束", "没有精确数字时明确说明测量口径"],
      ["最大的阻力来自哪里？", "你如何确认结果确实由这项改动带来？"],
    );
    add(
      "行为面试",
      `讲一个你在 ${experience.company} 推动跨团队决策的真实例子：各方目标有什么冲突，你如何让事情继续向前？`,
      "目标 JD 强调协作与交付，需要验证影响力、判断力和沟通方式。",
      [`工作经历 · ${experience.company}`, "JD · 协作沟通"],
      ["用 STAR 结构控制在 2–3 分钟", "说清利益相关方与分歧", "突出自己的动作、结果和反思"],
      ["如果对方仍不同意，你会如何升级或止损？"],
    );
  }

  for (const keyword of keywords) {
    add(
      "技术基础",
      `围绕 ${keyword}，请解释一个你在真实项目里遇到的问题、定位过程、解决方案与取舍。`,
      `“${keyword}”来自目标 JD，面试官通常会从概念继续追到真实应用。`,
      [`JD · ${keyword}`, keywordMatched(keyword) ? "材料 · 已有相关证据" : "材料缺口 · 证据不足"],
      ["先给出概念和适用边界", "用一个真实项目连接理论与实践", "主动说明取舍和失败情况"],
      [`如果不使用 ${keyword}，你会选择什么方案？`],
    );
  }

  add(
    "系统设计",
    `请设计一个面向「${job.title}」日常工作的核心系统：先澄清需求，再说明模块、状态、接口、异常恢复和监控方案。`,
    "综合系统设计题可以同时观察需求拆解、架构边界、可靠性和表达结构。",
    [`JD · ${job.title}`, ...state.repos.slice(0, 1).map((repo) => `Repo · ${repo.name}`)],
    ["先问规模、角色和成功指标", "划分核心模块与数据所有权", "覆盖失败、恢复、监控和演进"],
    ["如果流量增长十倍，先改哪里？", "如何做灰度发布和回滚？"],
  );
  add(
    "系统设计",
    `如果要把 ${job.company} 的相关产品做成支持实时更新、离线恢复和多端同步的应用，你会怎样设计前端状态与事件协议？`,
    "该问题结合岗位场景验证复杂交互、状态一致性与工程化能力。",
    [`JD · ${job.company}`, "材料 · 前端工程经验"],
    [
      "区分服务端状态、持久状态和临时 UI 状态",
      "定义事件顺序、幂等与冲突策略",
      "讨论断线恢复和可观测性",
    ],
    ["多窗口同时修改时如何解决冲突？"],
  );
  add(
    "行为面试",
    "讲一个上线后结果没有达到预期的项目。你如何发现问题、承担责任并推动修正？",
    "失败复盘能验证诚实度、学习速度和结果意识，也能暴露只讲成功案例的盲区。",
    ["工作经历 · 复盘能力"],
    ["选择真实且有边界的例子", "不甩锅，清楚说明自己的判断", "给出后续机制性改进"],
    ["同类问题后来是否再次发生？"],
  );
  add(
    "行为面试",
    `为什么选择 ${job.company} 的 ${job.title}，你的已有经历能立即解决什么问题，还需要补什么？`,
    "考察求职动机是否建立在 JD 与个人证据上，而不是通用话术。",
    [`JD · ${job.title}`, `个人目标 · ${state.profile.target || "待补充"}`],
    [
      "把公司、岗位和个人方向分别讲清",
      "用两项强证据说明即时价值",
      "坦诚说明一项待补能力和学习计划",
    ],
    ["如果拿到多个 offer，你最看重什么？"],
  );

  for (const keyword of unmatched) {
    add(
      "能力差距",
      `JD 要求 ${keyword}，但当前经历和 Repo 中缺少直接证据。你会如何诚实回答，并说明可迁移经验与补齐计划？`,
      "这是当前材料的显性缺口，提前准备比临场夸大更可信。",
      [`JD · ${keyword}`, `材料缺口 · ${keyword}`],
      ["明确说出实际经验边界", "连接相邻能力与学习速度", "给出已开始或可验证的补齐动作"],
      [`如果入职第一周就要使用 ${keyword}，你会怎么做？`],
    );
  }

  add(
    "能力差距",
    "你的材料中哪些结果还缺少数字或清晰口径？面试时如何在不夸大的前提下证明影响？",
    "量化不足会降低简历与口头陈述的可信度，需要提前确认哪些数据可说、哪些只能描述趋势。",
    ["材料缺口 · 量化结果"],
    ["区分事实、区间和主观判断", "说明指标定义与测量窗口", "无法确认的数据不报精确值"],
    ["为什么当时没有建立数据基线？"],
  );

  const preferredCategory = {
    technical: "技术基础",
    project: "项目深挖",
    behavioral: "行为面试",
    "system-design": "系统设计",
  }[options.mode];

  let ordered = questions;
  if (preferredCategory) {
    ordered = [...questions].sort(
      (left, right) =>
        Number(right.category === preferredCategory) - Number(left.category === preferredCategory),
    );
  } else {
    const buckets = new Map();
    for (const question of questions) {
      if (!buckets.has(question.category)) buckets.set(question.category, []);
      buckets.get(question.category).push(question);
    }
    ordered = [];
    while ([...buckets.values()].some((items) => items.length)) {
      for (const items of buckets.values()) {
        const next = items.shift();
        if (next) ordered.push(next);
      }
    }
  }
  return ordered.slice(0, Math.min(20, Math.max(3, options.count || 10)));
}

async function generateInterviewSet(form) {
  const job = selectedJob();
  if (!job) return notify("先选择或添加一个职位", "error");
  const data = new FormData(form);
  const options = {
    mode: String(data.get("mode") || "balanced"),
    difficulty: String(data.get("difficulty") || "进阶"),
    count: Number(data.get("count") || 10),
    language: String(data.get("language") || "中文"),
    focus: String(data.get("focus") || "").trim(),
  };
  closeDialog("interview-dialog");

  if (!window.codeshellPanel?.call) {
    const set = {
      id: uid("interview"),
      jobId: job.id,
      title: `${job.company} · ${INTERVIEW_MODE_LABELS[options.mode] || "定制面试"}`,
      mode: options.mode,
      difficulty: options.difficulty,
      createdAt: new Date().toISOString(),
      questions: buildInterviewQuestions(job, options),
    };
    state.interviewSets = [set, ...state.interviewSets].slice(0, 20);
    state.selectedInterviewSetId = set.id;
    state.interviewCategoryFilter = "全部";
    state.activeView = "interviews";
    persist();
    renderAll();
    notify("已生成可编辑预览题单；安装到 CodeShell 后，Agent 会进一步按材料深挖");
    return;
  }

  const prompt = [
    "请使用 job-hunt-hq:job-hunt-workflow skill 和 panel-app:job-hunt-hq 工具生成岗位定制面试题。",
    `目标职位 ID：${job.id}`,
    `题单模式：${options.mode}（${INTERVIEW_MODE_LABELS[options.mode] || "综合面试"}）`,
    `难度：${options.difficulty}；数量：${options.count}；回答语言：${options.language}。`,
    options.focus ? `特别关注：${options.focus}` : "特别关注：根据 JD 与候选人证据自动判断。",
    "先调用 get_job_search_context；项目中有 CODESHELL.md 时按它读取相关资料，再交叉核对 JD、工作经历、代码项目和当前简历。",
    "若识别到新的候选人资料，先调用 save_candidate_context 更新面板。",
    "每道题都要说明为什么问、关联哪些真实证据、回答要点和可能追问；同时覆盖最明显的材料缺口。不要编造项目、技术、职责或数字。",
    "完成后必须调用 save_interview_question_set 写回面板。",
  ].join("\n");
  try {
    await hostCall("agent.submitPrompt", { prompt });
    notify("Agent 正在读取当前项目并生成面试题，完成后会自动显示");
  } catch (error) {
    notify(error instanceof Error ? error.message : "提交面试题生成失败", "error");
  }
}

async function simulateInterviewSession() {
  const set = selectedInterviewSet();
  const job = set ? state.jobs.find((item) => item.id === set.jobId) : null;
  if (!set || !job) return notify("先选择一套面试题", "error");
  if (!window.codeshellPanel?.call) {
    return notify("安装到 CodeShell 后可开始一题一题的模拟面试");
  }
  const prompt = [
    "请使用 job-hunt-hq:job-hunt-workflow skill 和 panel-app:job-hunt-hq 工具，开始一场互动模拟面试。",
    `目标职位 ID：${job.id}；面试题单 ID：${set.id}；题单标题：${set.title}。`,
    "先调用 get_job_search_context 读取完整题单；项目中有 CODESHELL.md 时再按它补充候选人上下文。每次只问一道题，在我回答前不要展示回答要点。",
    "收到回答后，从事实证据、结构清晰度、技术深度和岗位相关性四方面给简短反馈，再选择一个追问或进入下一题。",
    "若我的回答超出已有材料，提醒我核实，不要替我补造事实。全部结束后给出优势、风险和下一轮练习建议。",
  ].join("\n");
  try {
    await hostCall("agent.submitPrompt", { prompt });
    notify("模拟面试已开始，Agent 会从第一题逐步追问");
  } catch (error) {
    notify(error instanceof Error ? error.message : "启动模拟面试失败", "error");
  }
}

async function submitSessionTask(prompt, successMessage) {
  if (context.busy) {
    notify("当前 Session 的 Agent 正在执行，请稍后再试", "error");
    return false;
  }
  try {
    await hostCall("agent.submitPrompt", { prompt });
    notify(
      window.codeshellPanel?.call
        ? successMessage
        : "浏览器预览不会启动 Agent；安装到 CodeShell 后会发送到当前 Session",
    );
    return true;
  } catch (error) {
    notify(error instanceof Error ? error.message : "发送到当前 Session 失败", "error");
    return false;
  }
}

function runCustomWorkflowInSession(taskIds = state.workflowTaskIds, jobs = selectedWorkflowJobs()) {
  const tasks = taskIds.filter((id) => Object.hasOwn(WORKFLOW_TASKS, id));
  if (!tasks.length) return notify("请先选择至少一个任务", "error");
  const needsJob = tasks.some((id) => WORKFLOW_TASKS[id].requiresJob);
  if (needsJob && !jobs.length) {
    return notify("JD 匹配、公司面经、题库和模拟面试需要先选择岗位", "error");
  }

  const jobLines = jobs.length
    ? jobs.map((job) => `- ${job.id}｜${job.company}｜${job.title}`)
    : ["- 未选择岗位：只处理通用候选人材料"];
  const instructions = {
    resume:
      "简历优化：对每个已选岗位分别生成一份有证据的 Markdown 简历并调用 save_resume_draft；未选岗位时保存通用基线简历，省略 job_id。",
    match:
      "JD 匹配：逐岗位拆解要求、已有证据、真实缺口与影响，并把结果合并进 save_preparation_plan。",
    intel:
      "公司与面经：逐岗位查官网、招聘页、可靠公开信息、评价和面试经验，区分 reported 与 predicted，并调用 save_job_research。",
    questions:
      "定制题库：逐岗位从 JD、Repo、工作经历和缺口生成问题、回答点与追问，并调用 save_interview_question_set。",
    prepare:
      "补强计划：整理优势、能力缺口、简历修改项和按优先级排序的下一步行动，并调用 save_preparation_plan；未选岗位时省略 job_id。",
    mock:
      "模拟面试：先完成其他已选结构化任务，再从一个已选岗位开始互动；每次只问一道题，收到回答后再反馈和追问。",
    debrief:
      "真实复盘：先简短询问我粘贴面试轮次、问题、回答、反馈与结果；收到后调用 save_interview_debrief，并据此更新补强计划。不要替我编造未提供的面试内容。",
  };
  const prompt = [
    "请使用 job-hunt-hq:job-hunt-workflow skill 和 panel-app:job-hunt-hq 工具，执行下面这组用户自由组合的任务。",
    "先调用 get_job_search_context，再读取当前项目中适用的 CODESHELL.md 与候选人材料。只执行本次勾选的任务，不要自动扩展成固定流程。",
    "已选岗位：",
    ...jobLines,
    `已选任务：${tasks.map((id) => WORKFLOW_TASKS[id].label).join("、")}`,
    ...tasks.map((id) => `- ${instructions[id]}`),
    "每完成一个可结构化的结果就立即用对应 Panel 工具写回，长任务用 save_workflow_progress 保存阶段进度。所有表述必须来自可核验材料；未知信息明确列为缺口，不编造经历、职责、技术或数字。",
    "访问招聘网站和评价来源时遵守访问限制，不导出登录凭据，不在浏览器外复用认证请求；受限信息标为待核验。",
  ].join("\n");
  return submitSessionTask(
    prompt,
    "组合任务已发送到当前 Session；结果会按岗位写回面板",
  );
}

function runCompanyResearchInSession() {
  const job = selectedJob();
  if (!job) return notify("先选择一个职位", "error");
  return submitSessionTask(
    [
      "请使用 job-hunt-hq:job-hunt-workflow skill，继续调研当前求职面板里选中的岗位。",
      `目标职位 ID：${job.id}；公司：${job.company}；岗位：${job.title}。`,
      "先调用 panel-app:job-hunt-hq 的 get_job_search_context 取得完整 JD，再查公司官网、招聘官网、产品与可靠公开信息。",
      "汇总公开员工或候选人评价与面试情报，严格区分事实、主观观点、公开报道的问题和根据 JD 推测的问题。",
      "保存来源、时间、置信度与核验缺口，并通过 save_job_research 写回面板。",
    ].join("\n"),
    "公司调研已发送到当前 Session；结果会写回调研页",
  );
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} 参数格式不正确`);
  }
}

function cleanText(value, maxLength) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function cleanTextList(value, maxItems, maxLength) {
  return Array.isArray(value)
    ? value
        .map((item) => cleanText(item, maxLength))
        .filter(Boolean)
        .slice(0, maxItems)
    : [];
}

function registerAgentTools(ready) {
  const register = window.codeshellPanel?.registerTool;
  if (!register) return;

  register("get_job_search_context", async (args = {}) => {
    await ready;
    assertPlainObject(args, "get_job_search_context");
    if (Object.keys(args).length) throw new Error("get_job_search_context 不接受参数");
    return {
      project: clone(projectContext),
      projectStatePath: PROJECT_STATE_PATH,
      selectedJobId: state.selectedJobId,
      selectedJob: clone(selectedJob()),
      opportunities: clone(state.jobs),
      profile: clone(state.profile),
      repositories: clone(state.repos),
      workHistory: clone(state.experiences),
      jobResearch: clone(state.jobResearch),
      workflowRuns: clone(state.workflowRuns),
      resume: clone(state.resume),
      interviewSets: clone(state.interviewSets),
      preparationPlans: clone(state.preparationPlans),
      interviewDebriefs: clone(state.interviewDebriefs),
      workflowSelection: {
        jobIds: clone(state.workflowJobIds),
        taskIds: clone(state.workflowTaskIds),
      },
      providerCatalog: clone(JOB_PROVIDERS),
      evidencePolicy:
        "Read panel context first. Check the current project's CODESHELL.md once and follow it when present; its absence is not a blocker. Use only verifiable project evidence; never invent facts or metrics.",
      collectionPolicy:
        "Use public pages or the connected visible browser, preserve source attribution, and never bypass access controls. Never export cookies or replay authenticated recruiting-site requests outside the browser.",
    };
  });

  register("save_candidate_context", async (args = {}) => {
    await ready;
    assertPlainObject(args, "save_candidate_context");
    assertPlainObject(args.profile, "profile");
    if (!Array.isArray(args.repositories) || !Array.isArray(args.work_history)) {
      throw new Error("repositories 和 work_history 必须是数组");
    }
    const text = (value, maxLength) =>
      String(value || "")
        .trim()
        .slice(0, maxLength);
    state.profile = {
      name: text(args.profile.name, 100) || "姓名待确认",
      role: text(args.profile.role, 120) || "目标职位待确认",
      contact: text(args.profile.contact, 300),
      target: text(args.profile.target, 500),
      summary: text(args.profile.summary, 3000),
    };
    state.repos = args.repositories.slice(0, 30).map((repo, index) => {
      assertPlainObject(repo, `repositories[${index}]`);
      if (!text(repo.name, 100) || !text(repo.summary, 3000)) {
        throw new Error(`repositories[${index}] 缺少 name 或 summary`);
      }
      return {
        id: text(repo.id, 100) || uid("repo"),
        name: text(repo.name, 100),
        path: text(repo.path, 1000),
        tech: text(repo.tech, 500),
        summary: text(repo.summary, 3000),
      };
    });
    state.experiences = args.work_history.slice(0, 30).map((experience, index) => {
      assertPlainObject(experience, `work_history[${index}]`);
      if (!text(experience.company, 100) || !text(experience.role, 120)) {
        throw new Error(`work_history[${index}] 缺少 company 或 role`);
      }
      return {
        id: text(experience.id, 100) || uid("exp"),
        company: text(experience.company, 100),
        role: text(experience.role, 120),
        period: text(experience.period, 100),
        achievements: Array.isArray(experience.achievements)
          ? experience.achievements
              .map((item) => text(item, 1000))
              .filter(Boolean)
              .slice(0, 20)
          : [],
      };
    });
    persist();
    renderAll();
    const projectSaved = await writeProjectSnapshot();
    renderMaterials();
    return {
      saved: true,
      projectSaved,
      repositories: state.repos.length,
      workHistory: state.experiences.length,
    };
  });

  register("save_job_opportunities", async (args = {}) => {
    await ready;
    assertPlainObject(args, "save_job_opportunities");
    if (!Array.isArray(args.jobs) || args.jobs.length < 1 || args.jobs.length > 12) {
      throw new Error("jobs 必须包含 1–12 个职位");
    }
    const incoming = args.jobs.map((job, index) => {
      assertPlainObject(job, `jobs[${index}]`);
      if (
        typeof job.company !== "string" ||
        !job.company.trim() ||
        typeof job.title !== "string" ||
        !job.title.trim()
      ) {
        throw new Error(`jobs[${index}] 缺少 company 或 title`);
      }
      const url = normalizeJobUrl(job.url);
      const sourceId = normalizeSourceId(job.source_id, job.source);
      const description = cleanText(job.description, 20000);
      const jdCompleteness = normalizeJdCompleteness(job.jd_completeness, description);
      if (jdCompleteness === "full" && !description) {
        throw new Error(`jobs[${index}] 标为 full 时必须提供 description`);
      }
      const now = new Date().toISOString();
      return {
        id: uid("agent-job"),
        company: job.company.trim().slice(0, 80),
        title: job.title.trim().slice(0, 120),
        location: String(job.location || "")
          .trim()
          .slice(0, 80),
        salary: String(job.salary || "")
          .trim()
          .slice(0, 80),
        source: String(job.source || "Agent 搜索")
          .trim()
          .slice(0, 40),
        sourceId,
        url,
        publishedAt: String(job.published_at || "")
          .trim()
          .slice(0, 80),
        employmentType: String(job.employment_type || "")
          .trim()
          .slice(0, 80),
        description,
        jdCompleteness,
        verificationNotes: cleanText(job.verification_notes, 2000),
        fetchedAt: cleanText(job.fetched_at, 80) || now,
        match: Number.isInteger(job.match) ? Math.min(100, Math.max(0, job.match)) : null,
        status: "saved",
        createdAt: now,
        updatedAt: now,
        sample: false,
      };
    });
    const upserted = upsertJobOpportunities(state.jobs, incoming, {
      dedupeKey: jobDedupeKey,
      metadataKey: jobMetadataKey,
    });
    state.jobs = upserted.jobs.slice(0, 80);
    if (upserted.inserted[0]) state.selectedJobId = upserted.inserted[0].id;
    state.jobSourceFilter = "all";
    state.activeView = "dashboard";
    persist();
    renderAll();
    const projectSaved = await writeProjectSnapshot();
    renderMaterials();
    return {
      saved: upserted.inserted.length,
      updated: upserted.updated,
      unchanged: upserted.unchanged,
      selectedJobId: state.selectedJobId,
      totalJobs: state.jobs.length,
      projectSaved,
    };
  });

  register("save_workflow_progress", async (args = {}) => {
    await ready;
    assertPlainObject(args, "save_workflow_progress");
    const statuses = ["running", "completed", "partial", "failed"];
    const stepIds = [
      "discover",
      "verify-jd",
      "company",
      "reviews",
      "interviews",
      "resume",
      "prepare",
      "debrief",
      "artifacts",
    ];
    const stepStatuses = ["pending", "running", "completed", "skipped", "failed"];
    if (!statuses.includes(args.status) || !stepIds.includes(args.current_step)) {
      throw new Error("status 或 current_step 无效");
    }
    const requestedId = cleanText(args.workflow_id, 100);
    const existing = requestedId
      ? state.workflowRuns.find((run) => run.id === requestedId)
      : null;
    if (requestedId && !existing) {
      throw new Error("workflow_id 不存在；首次调用时请省略 workflow_id");
    }
    const now = new Date().toISOString();
    const steps = Array.isArray(args.steps)
      ? args.steps.slice(0, 12).map((step, index) => {
          assertPlainObject(step, `steps[${index}]`);
          const id = cleanText(step.id, 80);
          if (!id || !stepStatuses.includes(step.status)) {
            throw new Error(`steps[${index}] 缺少有效 id 或 status`);
          }
          return {
            id,
            status: step.status,
            message: cleanText(step.message, 500),
          };
        })
      : existing?.steps || [];
    const run = {
      id: existing?.id || uid("workflow"),
      status: args.status,
      currentStep: args.current_step,
      message: cleanText(args.message, 1000),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      steps,
    };
    state.workflowRuns = [
      run,
      ...state.workflowRuns.filter((item) => item.id !== run.id),
    ].slice(0, 30);
    persist();
    renderAll();
    const projectSaved = await writeProjectSnapshot();
    return {
      saved: true,
      workflowId: run.id,
      status: run.status,
      currentStep: run.currentStep,
      projectSaved,
    };
  });

  register("save_job_research", async (args = {}) => {
    await ready;
    assertPlainObject(args, "save_job_research");
    const job = state.jobs.find((item) => item.id === args.job_id);
    if (!job) throw new Error("job_id 不存在，请先保存或读取岗位");
    assertPlainObject(args.company, "company");
    assertPlainObject(args.interview_intel, "interview_intel");
    if (!cleanText(args.company.official_name, 100) || !cleanText(args.company.summary, 5000)) {
      throw new Error("company 缺少 official_name 或 summary");
    }
    if (
      !Array.isArray(args.reviews) ||
      !Array.isArray(args.risks) ||
      !Array.isArray(args.sources)
    ) {
      throw new Error("reviews、risks 和 sources 必须是数组");
    }
    const sentimentValues = ["positive", "mixed", "negative", "unknown"];
    const confidenceValues = ["high", "medium", "low"];
    const sourceKinds = ["official", "job", "review", "interview", "news", "other"];
    const questionOrigins = ["reported", "predicted"];
    const reviews = args.reviews.slice(0, 50).map((review, index) => {
      assertPlainObject(review, `reviews[${index}]`);
      if (
        !cleanText(review.source, 120) ||
        !cleanText(review.summary, 3000) ||
        !sentimentValues.includes(review.sentiment) ||
        !confidenceValues.includes(review.confidence)
      ) {
        throw new Error(`reviews[${index}] 缺少来源、摘要、情绪或可信度`);
      }
      return {
        source: cleanText(review.source, 120),
        title: cleanText(review.title, 200),
        url: cleanText(review.url, 1000),
        publishedAt: cleanText(review.published_at, 80),
        sentiment: review.sentiment,
        summary: cleanText(review.summary, 3000),
        pros: cleanTextList(review.pros, 15, 500),
        cons: cleanTextList(review.cons, 15, 500),
        confidence: review.confidence,
      };
    });
    const questions = Array.isArray(args.interview_intel.questions)
      ? args.interview_intel.questions.slice(0, 30).map((question, index) => {
          assertPlainObject(question, `interview_intel.questions[${index}]`);
          const prompt = cleanText(question.question, 1000);
          const sourceUrl = cleanText(question.source_url, 1000);
          if (
            prompt.length < 8 ||
            !questionOrigins.includes(question.origin) ||
            (question.origin === "reported" && !sourceUrl)
          ) {
            throw new Error(`interview_intel.questions[${index}] 缺少问题或有效 origin`);
          }
          return {
            question: prompt,
            category: cleanText(question.category, 100),
            origin: question.origin,
            sourceUrl,
          };
        })
      : [];
    const sources = args.sources.slice(0, 60).map((source, index) => {
      assertPlainObject(source, `sources[${index}]`);
      if (
        !sourceKinds.includes(source.kind) ||
        !cleanText(source.title, 300) ||
        !cleanText(source.url, 1000) ||
        !cleanText(source.accessed_at, 80)
      ) {
        throw new Error(`sources[${index}] 缺少类型、标题、URL 或访问时间`);
      }
      return {
        kind: source.kind,
        title: cleanText(source.title, 300),
        publisher: cleanText(source.publisher, 200),
        url: cleanText(source.url, 1000),
        publishedAt: cleanText(source.published_at, 80),
        accessedAt: cleanText(source.accessed_at, 80),
        notes: cleanText(source.notes, 1000),
      };
    });
    const existing = state.jobResearch.find((report) => report.jobId === job.id);
    const report = {
      id: existing?.id || uid("research"),
      jobId: job.id,
      updatedAt: new Date().toISOString(),
      sample: false,
      company: {
        officialName: cleanText(args.company.official_name, 100),
        website: cleanText(args.company.website, 1000),
        careersUrl: cleanText(args.company.careers_url, 1000),
        summary: cleanText(args.company.summary, 5000),
        industry: cleanText(args.company.industry, 200),
        stage: cleanText(args.company.stage, 200),
        size: cleanText(args.company.size, 200),
        locations: cleanTextList(args.company.locations, 20, 300),
        products: cleanTextList(args.company.products, 30, 500),
        techSignals: cleanTextList(args.company.tech_signals, 30, 300),
        hiringSignals: cleanTextList(args.company.hiring_signals, 30, 500),
      },
      reviews,
      interviewIntel: {
        summary: cleanText(args.interview_intel.summary, 5000),
        process: cleanTextList(args.interview_intel.process, 20, 500),
        themes: cleanTextList(args.interview_intel.themes, 30, 300),
        questions,
      },
      risks: cleanTextList(args.risks, 30, 1000),
      sources,
    };
    state.jobResearch = [
      report,
      ...state.jobResearch.filter((item) => item.jobId !== job.id),
    ].slice(0, 80);
    state.selectedJobId = job.id;
    state.activeView = "research";
    persist();
    renderAll();
    const projectSaved = await writeProjectSnapshot();
    renderMaterials();
    return {
      saved: true,
      jobId: job.id,
      researchId: report.id,
      reviewCount: reviews.length,
      sourceCount: sources.length,
      projectSaved,
    };
  });

  register("save_interview_question_set", async (args = {}) => {
    await ready;
    assertPlainObject(args, "save_interview_question_set");
    const job = state.jobs.find((item) => item.id === args.job_id);
    if (!job) throw new Error("job_id 不存在，请先读取面板上下文");
    if (
      typeof args.title !== "string" ||
      !args.title.trim() ||
      !Object.hasOwn(INTERVIEW_MODE_LABELS, args.mode) ||
      !Array.isArray(args.questions) ||
      args.questions.length < 3 ||
      args.questions.length > 30
    ) {
      throw new Error("title、有效 mode 和 3–30 道 questions 为必填");
    }
    const questions = args.questions.map((question, index) => {
      assertPlainObject(question, `questions[${index}]`);
      if (
        typeof question.category !== "string" ||
        !question.category.trim() ||
        !["基础", "进阶", "挑战"].includes(question.difficulty) ||
        typeof question.question !== "string" ||
        question.question.trim().length < 8 ||
        typeof question.why !== "string" ||
        !question.why.trim()
      ) {
        throw new Error(`questions[${index}] 缺少分类、难度、问题或出题原因`);
      }
      const normalizeList = (value, maxItems, maxLength) =>
        Array.isArray(value)
          ? value
              .map((item) =>
                String(item || "")
                  .trim()
                  .slice(0, maxLength),
              )
              .filter(Boolean)
              .slice(0, maxItems)
          : [];
      return {
        id: uid("agent-question"),
        category: question.category.trim().slice(0, 40),
        difficulty: question.difficulty,
        question: question.question.trim().slice(0, 600),
        why: question.why.trim().slice(0, 600),
        evidenceRefs: normalizeList(question.evidence_refs, 8, 160),
        answerPoints: normalizeList(question.answer_points, 8, 300),
        followUps: normalizeList(question.follow_ups, 5, 500),
      };
    });
    const set = {
      id: uid("agent-interview"),
      jobId: job.id,
      title: args.title.trim().slice(0, 120),
      mode: args.mode,
      difficulty: questions.some((question) => question.difficulty === "挑战")
        ? "挑战"
        : questions[0]?.difficulty || "进阶",
      createdAt: new Date().toISOString(),
      questions,
    };
    state.interviewSets = [set, ...state.interviewSets].slice(0, 20);
    state.selectedJobId = job.id;
    state.selectedInterviewSetId = set.id;
    state.interviewCategoryFilter = "全部";
    state.activeView = "interviews";
    persist();
    renderAll();
    const projectSaved = await writeProjectSnapshot();
    renderMaterials();
    return {
      saved: true,
      jobId: job.id,
      interviewSetId: set.id,
      questionCount: questions.length,
      categories: [...new Set(questions.map((question) => question.category))],
      projectSaved,
    };
  });

  register("save_preparation_plan", async (args = {}) => {
    await ready;
    assertPlainObject(args, "save_preparation_plan");
    const requestedJobId = cleanText(args.job_id, 80);
    const job = requestedJobId
      ? state.jobs.find((item) => item.id === requestedJobId)
      : null;
    if (requestedJobId && !job) throw new Error("job_id 不存在，请先读取面板上下文");
    if (
      !cleanText(args.title, 160) ||
      !cleanText(args.summary, 5000) ||
      !Array.isArray(args.strengths) ||
      !Array.isArray(args.gaps) ||
      !Array.isArray(args.resume_changes) ||
      !Array.isArray(args.next_actions)
    ) {
      throw new Error(
        "title、summary、strengths、gaps、resume_changes 和 next_actions 为必填",
      );
    }
    const priorities = ["high", "medium", "low"];
    const actionKinds = ["resume", "evidence", "study", "practice", "research"];
    const gaps = args.gaps.slice(0, 30).map((gap, index) => {
      assertPlainObject(gap, `gaps[${index}]`);
      if (
        !cleanText(gap.area, 120) ||
        !priorities.includes(gap.priority) ||
        !Array.isArray(gap.actions)
      ) {
        throw new Error(`gaps[${index}] 缺少 area、priority 或 actions`);
      }
      return {
        area: cleanText(gap.area, 120),
        evidence: cleanText(gap.evidence, 1000),
        impact: cleanText(gap.impact, 1000),
        priority: gap.priority,
        actions: cleanTextList(gap.actions, 8, 500),
        practice: cleanText(gap.practice, 1000),
      };
    });
    const nextActions = args.next_actions.slice(0, 30).map((action, index) => {
      assertPlainObject(action, `next_actions[${index}]`);
      if (
        !cleanText(action.title, 160) ||
        !actionKinds.includes(action.kind) ||
        !priorities.includes(action.priority)
      ) {
        throw new Error(`next_actions[${index}] 缺少有效 title、kind 或 priority`);
      }
      return {
        title: cleanText(action.title, 160),
        kind: action.kind,
        detail: cleanText(action.detail, 1000),
        priority: action.priority,
      };
    });
    const existing = state.preparationPlans.find(
      (plan) => (plan.jobId || "") === requestedJobId,
    );
    const plan = {
      id: existing?.id || uid("plan"),
      jobId: requestedJobId,
      title: cleanText(args.title, 160),
      summary: cleanText(args.summary, 5000),
      strengths: cleanTextList(args.strengths, 20, 500),
      gaps,
      resumeChanges: cleanTextList(args.resume_changes, 20, 800),
      nextActions,
      updatedAt: new Date().toISOString(),
      sample: false,
    };
    state.preparationPlans = [
      plan,
      ...state.preparationPlans.filter((item) => (item.jobId || "") !== requestedJobId),
    ].slice(0, 80);
    if (job) state.selectedJobId = job.id;
    if (!job) state.selectedJobId = "";
    state.activeView = "interviews";
    persist();
    renderAll();
    const projectSaved = await writeProjectSnapshot();
    return {
      saved: true,
      jobId: requestedJobId || null,
      preparationPlanId: plan.id,
      gapCount: gaps.length,
      nextActionCount: nextActions.length,
      projectSaved,
    };
  });

  register("save_interview_debrief", async (args = {}) => {
    await ready;
    assertPlainObject(args, "save_interview_debrief");
    const requestedJobId = cleanText(args.job_id, 80);
    const job = requestedJobId
      ? state.jobs.find((item) => item.id === requestedJobId)
      : null;
    if (requestedJobId && !job) throw new Error("job_id 不存在，请先读取面板上下文");
    if (
      !cleanText(args.round, 120) ||
      !["pending", "pass", "reject", "unknown"].includes(args.outcome) ||
      !cleanText(args.summary, 5000) ||
      !Array.isArray(args.questions) ||
      !Array.isArray(args.strengths) ||
      !Array.isArray(args.gaps) ||
      !Array.isArray(args.next_actions)
    ) {
      throw new Error(
        "round、outcome、summary、questions、strengths、gaps 和 next_actions 为必填",
      );
    }
    const signals = ["strong", "mixed", "weak", "unknown"];
    const questions = args.questions.slice(0, 30).map((question, index) => {
      assertPlainObject(question, `questions[${index}]`);
      if (
        !cleanText(question.question, 1000) ||
        !signals.includes(question.signal) ||
        typeof question.reported_feedback !== "string" ||
        typeof question.analysis !== "string"
      ) {
        throw new Error(
          `questions[${index}] 缺少 question、有效 signal、reported_feedback 或 analysis`,
        );
      }
      return {
        question: cleanText(question.question, 1000),
        answerSummary: cleanText(question.answer_summary, 2000),
        signal: question.signal,
        reportedFeedback: cleanText(question.reported_feedback, 2000),
        analysis: cleanText(question.analysis, 2000),
        betterAnswerPoints: cleanTextList(question.better_answer_points, 10, 500),
      };
    });
    const debrief = {
      id: uid("debrief"),
      jobId: requestedJobId,
      round: cleanText(args.round, 120),
      interviewedAt: cleanText(args.interviewed_at, 80) || new Date().toISOString(),
      outcome: args.outcome,
      summary: cleanText(args.summary, 5000),
      questions,
      strengths: cleanTextList(args.strengths, 20, 500),
      gaps: cleanTextList(args.gaps, 20, 800),
      nextActions: cleanTextList(args.next_actions, 20, 800),
      createdAt: new Date().toISOString(),
      sample: false,
    };
    state.interviewDebriefs = [debrief, ...state.interviewDebriefs].slice(0, 80);
    if (job) state.selectedJobId = job.id;
    if (!job) state.selectedJobId = "";
    state.activeView = "interviews";
    persist();
    renderAll();
    const projectSaved = await writeProjectSnapshot();
    return {
      saved: true,
      jobId: requestedJobId || null,
      interviewDebriefId: debrief.id,
      questionCount: questions.length,
      projectSaved,
    };
  });

  register("save_resume_draft", async (args = {}) => {
    await ready;
    assertPlainObject(args, "save_resume_draft");
    const requestedJobId = cleanText(args.job_id, 80);
    const job = requestedJobId
      ? state.jobs.find((item) => item.id === requestedJobId)
      : null;
    if (requestedJobId && !job) throw new Error("job_id 不存在，请先读取面板上下文");
    if (
      typeof args.title !== "string" ||
      !args.title.trim() ||
      typeof args.markdown !== "string" ||
      args.markdown.trim().length < 80
    ) {
      throw new Error("title 和至少 80 字符的 markdown 为必填");
    }
    if (state.resume.markdown && state.resume.jobId !== requestedJobId) archiveCurrentResume();
    const now = new Date().toISOString();
    state.selectedJobId = requestedJobId;
    state.activeView = "dashboard";
    if (job) job.status = "tailoring";
    state.resume = {
      jobId: requestedJobId,
      versionId: uid("resume"),
      title: args.title.trim().slice(0, 120),
      markdown: args.markdown.trim().slice(0, 50000),
      notes: Array.isArray(args.notes)
        ? args.notes.map((note) => String(note).slice(0, 300)).slice(0, 12)
        : [],
      updatedAt: now,
    };
    resumeMode = "preview";
    persist();
    renderAll();
    const projectSaved = await writeProjectSnapshot();
    renderMaterials();
    return {
      saved: true,
      jobId: requestedJobId || null,
      title: state.resume.title,
      updatedAt: now,
      characterCount: state.resume.markdown.length,
      projectSaved,
    };
  });
}

function bindEvents() {
  document.querySelector("#open-session-bridge").addEventListener("click", () => {
    openSessionBridge(currentSessionTarget());
  });
  document.querySelector("#close-session-bridge").addEventListener("click", closeSessionBridge);
  elements.sessionQuickActions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-session-quick-index]");
    if (!button) return;
    const action = sessionActionsFor(sessionBridgeContext)[Number(button.dataset.sessionQuickIndex)];
    if (!action) return;
    elements.sessionInstruction.value = action.prompt;
    elements.sessionInstruction.focus();
  });
  elements.sendSessionInstruction.addEventListener("click", async () => {
    const instruction = elements.sessionInstruction.value.trim();
    if (!instruction) return notify("先写一句希望 Agent 做什么", "error");
    const sent = await submitSessionTask(
      buildSessionBridgePrompt(instruction),
      "已把当前对象和指令发送到 Session；结果会继续写回面板",
    );
    if (sent) {
      elements.sessionInstruction.value = "";
      elements.sessionBridgeStateLabel.textContent = "已发送，等待 Agent 回写";
    }
  });

  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.viewTarget;
      persist();
      renderAll();
    });
  });

  document.querySelectorAll("[data-status-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.statusFilter = button.dataset.statusFilter;
      state.activeView = "dashboard";
      persist();
      renderAll();
    });
  });

  document.querySelectorAll("[data-job-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.jobFilter = button.dataset.jobFilter;
      document.querySelectorAll("[data-job-filter]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      persist();
      renderJobs();
    });
  });

  elements.jobSourceFilter.addEventListener("change", () => {
    state.jobSourceFilter = elements.jobSourceFilter.value;
    persist();
    renderJobs();
  });

  elements.jobList.addEventListener("click", (event) => {
    const sessionButton = event.target.closest("[data-session-job-id]");
    if (sessionButton) {
      const job = state.jobs.find((item) => item.id === sessionButton.dataset.sessionJobId);
      if (!job) return;
      openSessionBridge(
        {
          kind: "job",
          title: `${job.company} · ${job.title}`,
          detail: `${job.source || "来源待确认"} · ${JD_COMPLETENESS_LABELS[normalizeJdCompleteness(job.jdCompleteness, job.description, true)]}`,
          payload: { jobId: job.id },
        },
        "拆解这个岗位最重要的要求，告诉我已有证据、真实缺口和最优先的准备动作。",
      );
      return;
    }
    const card = event.target.closest("[data-job-id]");
    if (!card) return;
    if (resumeMode === "edit" && state.resume.jobId === state.selectedJobId) {
      state.resume.markdown = elements.resumeEditor.value;
      state.resume.updatedAt = new Date().toISOString();
    }
    state.selectedJobId = card.dataset.jobId;
    resumeMode = "preview";
    persist();
    renderAll();
  });

  document
    .querySelector("#open-search")
    .addEventListener("click", () => openDialog("agent-dialog"));
  document.querySelector("#focus-workflow-builder").addEventListener("click", () => {
    state.activeView = "dashboard";
    renderAll();
    elements.workflowBuilder.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.querySelectorAll("[data-workflow-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      state.workflowTaskIds = [...(WORKFLOW_PRESETS[button.dataset.workflowPreset] || [])];
      persist();
      renderWorkflowBuilder();
    });
  });
  elements.workflowJobPicker.addEventListener("click", (event) => {
    const button = event.target.closest("[data-workflow-job-id]");
    if (!button) return;
    const id = button.dataset.workflowJobId;
    state.workflowJobIds = state.workflowJobIds.includes(id)
      ? state.workflowJobIds.filter((item) => item !== id)
      : [...state.workflowJobIds, id];
    persist();
    renderWorkflowBuilder();
  });
  elements.workflowTaskPicker.addEventListener("click", (event) => {
    const button = event.target.closest("[data-workflow-task]");
    if (!button) return;
    const id = button.dataset.workflowTask;
    state.workflowTaskIds = state.workflowTaskIds.includes(id)
      ? state.workflowTaskIds.filter((item) => item !== id)
      : [...state.workflowTaskIds, id];
    persist();
    renderWorkflowBuilder();
  });
  elements.runCustomWorkflow.addEventListener("click", () =>
    void runCustomWorkflowInSession(),
  );
  elements.runCompanyResearch.addEventListener("click", () =>
    void runCompanyResearchInSession(),
  );
  elements.continueResearchSession.addEventListener("click", () => {
    const report = selectedResearch();
    const job = selectedJob();
    if (!report) return notify("当前还没有可继续的调研报告", "error");
    openSessionBridge({
      kind: "research",
      title: `${report.company?.officialName || job?.company || "公司"}调研报告`,
      detail: job ? `${job.company} · ${job.title}` : "公司与面经",
      payload: { jobId: report.jobId, researchId: report.id },
    });
  });
  for (const id of ["open-job-form", "compact-add-job", "empty-add-job"]) {
    document.querySelector(`#${id}`).addEventListener("click", () => openDialog("job-dialog"));
  }
  document.querySelector("#sync-project-context").addEventListener("click", () => {
    void syncProjectContext({ quiet: false });
  });
  document.querySelector("#open-interview-form").addEventListener("click", () => {
    if (!selectedJob()) return notify("先选择或添加一个职位", "error");
    openDialog("interview-dialog");
  });
  elements.regenerateInterview.addEventListener("click", () => {
    const set = selectedInterviewSet();
    if (set) state.selectedJobId = set.jobId;
    openDialog("interview-dialog");
  });
  elements.simulateInterview.addEventListener("click", () => void simulateInterviewSession());
  elements.refreshPreparationPlan.addEventListener("click", () => {
    const job = selectedJob();
    void runCustomWorkflowInSession(job ? ["match", "prepare"] : ["prepare"], job ? [job] : []);
  });
  elements.startInterviewDebrief.addEventListener("click", () => {
    const job = selectedJob();
    void runCustomWorkflowInSession(["debrief"], job ? [job] : []);
  });
  elements.preparationGapList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-session-gap-index]");
    if (!button) return;
    const plan = selectedPreparationPlan();
    const gap = plan?.gaps?.[Number(button.dataset.sessionGapIndex)];
    if (!plan || !gap) return;
    openSessionBridge(
      {
        kind: "gap",
        title: gap.area || "能力缺口",
        detail: gap.impact || gap.evidence || "当前补强计划",
        payload: {
          jobId: plan.jobId || "",
          preparationPlanId: plan.id,
          gapIndex: Number(button.dataset.sessionGapIndex),
        },
      },
      "针对这个缺口，先告诉我需要补充哪些真实材料，再把可执行的下一步写回补强计划。",
    );
  });
  elements.interviewDebriefList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-session-debrief-id]");
    if (!button) return;
    const debrief = state.interviewDebriefs.find(
      (item) => item.id === button.dataset.sessionDebriefId,
    );
    if (!debrief) return;
    openSessionBridge({
      kind: "debrief",
      title: debrief.round || "真实面试复盘",
      detail: debrief.summary || "继续分析这次面试",
      payload: { jobId: debrief.jobId || "", interviewDebriefId: debrief.id },
    });
  });
  elements.interviewQuestionList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-session-question-id]");
    if (!button) return;
    const set = selectedInterviewSet();
    const question = set?.questions?.find(
      (item) => item.id === button.dataset.sessionQuestionId,
    );
    if (!set || !question) return;
    openSessionBridge(
      {
        kind: "question",
        title: question.question,
        detail: `${question.category || "岗位问题"} · ${question.difficulty || "进阶"}`,
        payload: {
          jobId: set.jobId,
          interviewSetId: set.id,
          questionId: question.id,
        },
      },
      "从这道题开始模拟面试。先只问问题，等我回答后再给反馈和追问。",
    );
  });

  elements.interviewSetList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-interview-set-id]");
    if (!card) return;
    const set = state.interviewSets.find((item) => item.id === card.dataset.interviewSetId);
    if (!set) return;
    state.selectedInterviewSetId = set.id;
    state.selectedJobId = set.jobId;
    state.interviewCategoryFilter = "全部";
    persist();
    renderAll();
  });

  elements.interviewCategoryFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-interview-category]");
    if (!button) return;
    state.interviewCategoryFilter = button.dataset.interviewCategory;
    persist();
    renderInterviews();
  });

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => closeDialog(button.dataset.closeDialog));
  });

  document.querySelector("#job-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const job = {
      id: uid("job"),
      company: String(data.get("company") || "").trim(),
      title: String(data.get("title") || "").trim(),
      location: String(data.get("location") || "").trim(),
      salary: String(data.get("salary") || "").trim(),
      source: String(data.get("source") || "手动添加").trim(),
      sourceId: normalizeSourceId("", data.get("source")),
      url: String(data.get("url") || "").trim(),
      description: String(data.get("description") || "").trim(),
      match: 76,
      status: "saved",
      createdAt: new Date().toISOString(),
      sample: false,
    };
    job.match = calculateMatch(job);
    state.jobs.unshift(job);
    state.selectedJobId = job.id;
    state.workflowJobIds = [job.id];
    state.statusFilter = "all";
    state.jobFilter = "all";
    state.jobSourceFilter = "all";
    state.activeView = "dashboard";
    form.reset();
    closeDialog("job-dialog");
    persist();
    renderAll();
    void writeProjectSnapshot().then(() => renderMaterials());
    notify(`已分析 ${job.company} 的 JD，当前匹配度 ${calculateMatch(job)}%`);
  });

  document.querySelector("#agent-search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void submitJobSearch(event.currentTarget);
  });

  document.querySelector("#resume-agent-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const request = String(new FormData(form).get("request") || "").trim();
    void submitResumeRevision(request);
  });

  document.querySelector("#interview-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void generateInterviewSet(event.currentTarget);
  });

  document.querySelectorAll("[data-resume-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      if (resumeMode === "edit" && button.dataset.resumeMode !== "edit") {
        state.resume.markdown = elements.resumeEditor.value;
        state.resume.updatedAt = new Date().toISOString();
        persist();
        void writeProjectSnapshot().then(() => renderMaterials());
      }
      resumeMode = button.dataset.resumeMode;
      renderResume();
      renderVersions();
    });
  });

  elements.resumeEditor.addEventListener("input", () => {
    if (state.resume.jobId !== (selectedJob()?.id || "")) return;
    state.resume.markdown = elements.resumeEditor.value;
    state.resume.updatedAt = new Date().toISOString();
    persist();
  });

  elements.generateResume.addEventListener("click", () => void generateDraft());
  elements.saveResume.addEventListener("click", () => void saveResumeToRepo());
  elements.continueResumeSession.addEventListener("click", () => {
    if (!state.resume.markdown) return notify("当前还没有可继续的简历", "error");
    openSessionBridge({
      kind: "resume",
      title: state.resume.title || "当前简历",
      detail: selectedJob()
        ? `${selectedJob().company} · ${selectedJob().title}`
        : "通用候选人简历",
      payload: {
        jobId: state.resume.jobId || "",
        resumeVersionId: state.resume.versionId || "",
      },
    });
  });
  elements.resumeVersionList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-session-resume-version-id]");
    if (!button) return;
    const versions = state.resume.versionId
      ? [state.resume, ...state.versions]
      : state.versions;
    const version = versions.find(
      (item) => (item.versionId || item.id) === button.dataset.sessionResumeVersionId,
    );
    if (!version) return;
    const job = state.jobs.find((item) => item.id === version.jobId);
    openSessionBridge({
      kind: "resume",
      title: version.title || "简历版本",
      detail: job ? `${job.company} · ${job.title}` : "通用候选人简历",
      payload: {
        jobId: version.jobId || "",
        resumeVersionId: version.versionId || version.id || "",
      },
    });
  });
  elements.askAgent.addEventListener("click", () => openDialog("resume-agent-dialog"));
  elements.discussJobSession.addEventListener("click", () => {
    const job = selectedJob();
    if (!job) return notify("先选择一个岗位", "error");
    openSessionBridge({
      kind: "job",
      title: `${job.company} · ${job.title}`,
      detail: `${job.source || "来源待确认"} · 匹配度 ${calculateMatch(job)}%`,
      payload: { jobId: job.id },
    });
  });
  elements.openSourceJob.addEventListener("click", async () => {
    const job = selectedJob();
    if (!job?.url) return notify("这个职位没有保存原始链接", "error");
    try {
      await hostCall("external.open", { url: job.url });
    } catch (error) {
      notify(error instanceof Error ? error.message : "无法打开职位原页", "error");
    }
  });
  elements.advanceJob.addEventListener("click", () => {
    const job = selectedJob();
    if (!job) return;
    job.status = "applied";
    persist();
    renderAll();
    void writeProjectSnapshot().then(() => renderMaterials());
    notify("已标记为投递，祝你拿到面试");
  });

  document.addEventListener("keydown", (event) => {
    if (
      !elements.sessionBridge.hidden &&
      (event.metaKey || event.ctrlKey) &&
      event.key === "Enter"
    ) {
      event.preventDefault();
      elements.sendSessionInstruction.click();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (resumeMode === "edit") {
        state.resume.markdown = elements.resumeEditor.value;
        state.resume.updatedAt = new Date().toISOString();
        persist({ quiet: false });
        renderResume();
        void writeProjectSnapshot().then(() => renderMaterials());
      } else if (state.resume.markdown) {
        void saveResumeToRepo();
      }
    }
    if (event.key === "Escape") {
      closeSessionBridge();
      document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
    }
  });
}

async function initialize() {
  try {
    const [saved, nextContext] = await Promise.all([
      hostCall("storage.get", { key: STORAGE_KEY }).catch(() => null),
      getContext().catch(() => null),
    ]);
    state = mergeState(saved);
    updateContext(nextContext);
    renderAll();
    await syncProjectContext({ quiet: true });
    if (window.codeshellPanel?.on) {
      window.codeshellPanel.on("context.changed", (next) => {
        const previousCwd = context.cwd;
        updateContext(next);
        if (next?.cwd && next.cwd !== previousCwd) {
          void syncProjectContext({ quiet: true });
        }
      });
    }
  } catch (error) {
    updateContext({ cwd: null, trusted: false, busy: false });
    renderAll();
    notify(error instanceof Error ? error.message : "初始化失败", "error");
  }
}

bindEvents();
const ready = initialize();
registerAgentTools(ready);
