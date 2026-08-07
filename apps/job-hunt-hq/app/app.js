import {
  assessJobOpportunity,
  JD_COMPLETENESS_LABELS,
  normalizeJdCompleteness,
  upsertJobDiscovery,
} from "./job-opportunities.mjs";
import {
  jobRemovalPreview,
  removeJobAndLinkedArtifacts,
} from "./job-removal-model.mjs";
import {
  JD_INBOX_PATH,
  JD_INTAKE_SOURCE_KIND_IDS,
  JD_INTAKE_STATUS_IDS,
  jdIntakeCounts,
  normalizeJdIntakeItems,
  upsertJdIntakeItems,
} from "./jd-intake-model.mjs";
import {
  DEFAULT_BASE_RESUME_CATEGORY,
  baseResumeRecords,
  collectResumeRecords,
  extractResumeClaims,
  isSupportedResumePhoto,
  normalizeClaimEvidence,
  normalizeResumeClaim,
  normalizeResumeCategory,
  normalizeResumeRecord,
  normalizeResumeStyle,
  resumeEvidenceCoverage,
  resumeRecordId,
  selectBaseResume,
} from "./resume-model.mjs";
import {
  appendTraceEvent as appendTraceEventModel,
  attachTraceArtifact,
  finalizeTrace,
  transitionTraceForBusy,
} from "./trace-model.mjs";
import { compactPanelLocalState } from "./storage-model.mjs";
import {
  buildProjectBootstrapTask,
  resolveProjectBootstrapStatus,
} from "./project-bootstrap.mjs";
import {
  CHANNEL_VERIFICATION_STATE_IDS,
  normalizeCustomProviders,
  normalizeDiscoveryPreferences,
  normalizeChannelVerifications,
  resolveChannelVerificationForSession,
  resolveJobRecency,
} from "./discovery-model.mjs";
import {
  APPLICATION_STAGE_IDS,
  APPLICATION_STAGE_LABELS,
  applicationStatusMatchesFilter,
  isWorkflowEligibleStage,
  normalizeJobApplication,
  updateApplicationProgress,
} from "./application-model.mjs";
import {
  PREPARATION_GAP_KIND_IDS,
  PREPARATION_GAP_KIND_LABELS,
  ROADMAP_KIND_IDS,
  ROADMAP_KIND_LABELS,
  ROADMAP_STATUS_IDS,
  ROADMAP_STATUS_LABELS,
  normalizePreparationGapKind,
  normalizeRoadmapMilestone,
  preparationGapCounts,
} from "./roadmap-model.mjs";
import {
  resolveCareerCurrentStep,
  resolveDashboardFocusKind,
} from "./workflow-model.mjs";

const STORAGE_KEY = "job-hunt-state-v1";
const PREVIEW_PREFIX = "codeshell-job-hunt-hq:";
const PROJECT_STATE_PATH = "job-hunt-panel.json";
const DISCOVERY_AUTOMATION_MARKER = "job-hunt-hq:scheduled-discovery:v1";

const JOB_PROVIDERS = [
  { id: "boss", label: "BOSS 直聘", domain: "zhipin.com", url: "https://www.zhipin.com" },
  { id: "linkedin", label: "LinkedIn", domain: "linkedin.com/jobs", url: "https://www.linkedin.com/jobs" },
  { id: "lagou", label: "拉勾", domain: "lagou.com", url: "https://www.lagou.com" },
  { id: "liepin", label: "猎聘", domain: "liepin.com", url: "https://www.liepin.com" },
  { id: "maimai", label: "脉脉", domain: "maimai.cn", url: "https://maimai.cn" },
  { id: "51job", label: "前程无忧", domain: "51job.com", url: "https://www.51job.com" },
  { id: "zhaopin", label: "智联招聘", domain: "zhaopin.com", url: "https://www.zhaopin.com" },
  { id: "official", label: "公司官网", domain: "company career pages" },
];

const PROVIDER_BY_ID = new Map(JOB_PROVIDERS.map((provider) => [provider.id, provider]));
const MANUAL_SOURCE_RULES = [
  { id: "recruiter", tokens: ["猎头"] },
  { id: "referral", tokens: ["朋友", "内推"] },
  { id: "message", tokens: ["聊天", "邮件"] },
  { id: "project-file", tokens: ["项目文件", "jd 文件"] },
];

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

const INTERVIEW_MODE_LABELS = {
  balanced: "综合面试",
  technical: "技术深挖",
  project: "项目复盘",
  behavioral: "行为面试",
  "system-design": "系统设计",
};

const WORK_MODE_LABELS = {
  any: "不限",
  onsite: "现场办公",
  hybrid: "混合办公",
  remote: "远程优先",
};

const CHANNEL_VERIFICATION_LABELS = {
  unchecked: "未验证",
  checking: "验证中",
  ready: "已可用",
  login_required: "需要登录",
  captcha_required: "需要验证码",
  blocked: "访问受限",
  unavailable: "暂不可用",
  stale: "需重新验证",
};

const JD_INTAKE_STATUS_LABELS = {
  staged: "等待识别",
  processing: "正在识别",
  imported: "已导入岗位池",
  needs_review: "需要确认",
  duplicate: "已存在",
  failed: "导入失败",
};

const JD_INTAKE_SOURCE_LABELS = {
  pasted_text: "粘贴文字",
  image: "截图 / 图片",
  pdf: "PDF",
  document: "Word / 文档",
  file: "文件",
  project_file: "项目文件",
  project_scan: "项目扫描",
  chat_export: "聊天导出",
};

const JD_UPLOAD_MAX_FILES = 6;
const JD_UPLOAD_MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const JD_UPLOAD_CHUNK_BYTES = 258 * 1024;

const TRACE_FEEDBACK_LABELS = {
  useful: "结果可用",
  needs_work: "需要调整",
};

const RESUME_EVIDENCE_PROTOCOL =
  "claim_evidence 必须逐字覆盖专业概述和每条能力、经历、项目 bullet；为每项标注 importance（core/supporting）、why_it_matters、至少一个带 evidence 说明的真实 Source，以及 1–4 个 interview_questions。没有证据的事实不要写入，证据偏弱时在 improvement 中说明如何补强。";

const RESUME_STRENGTH_LABELS = {
  strong: "直接证据",
  supported: "本人确认",
  referenced: "只有定位",
  needs_review: "待核验",
  missing: "缺少证据",
};

const RESUME_SOURCE_KIND_LABELS = {
  experience: "经历",
  repository: "Repo",
  commit: "Commit",
  file: "文件",
  user: "本人确认",
  other: "其他",
};

const WORKFLOW_TASKS = {
  resume: { label: "简历优化", requiresJob: false },
  match: { label: "JD 匹配", requiresJob: true },
  intel: { label: "公司情报", requiresJob: true },
  questions: { label: "定制题库", requiresJob: true },
  commits: { label: "Commit 深挖题", requiresJob: false },
  prepare: { label: "补强计划", requiresJob: false },
  mock: { label: "模拟面试", requiresJob: true },
  debrief: { label: "真实复盘", requiresJob: false },
};

const WORKFLOW_PRESETS = {
  resume: ["resume", "match", "prepare"],
  interview: ["match", "intel", "questions", "commits", "prepare"],
  debrief: ["debrief", "prepare", "resume"],
  full: ["resume", "match", "intel", "questions", "prepare"],
};

const PANEL_VIEWS = new Set([
  "dashboard",
  "materials",
  "channels",
  "research",
  "resumes",
  "interviews",
]);

const seedState = {
  selectedJobId: "job-aurora",
  selectedInterviewSetId: "iset-aurora",
  selectedBaseResumeId: "",
  workflowJobIds: ["job-aurora"],
  workflowTaskIds: ["resume", "match", "prepare"],
  activeView: "dashboard",
  statusFilter: "all",
  jobFilter: "all",
  jobSourceFilter: "all",
  interviewCategoryFilter: "全部",
  sessionTraceFilter: "all",
  sessionActivity: [],
  discoveryPreferences: {
    keyword: "AI 产品前端工程师",
    location: "上海",
    seniority: "3–5 年",
    count: 8,
    providers: ["boss", "linkedin", "lagou", "liepin", "official"],
    freshnessDays: 7,
    workMode: "any",
    exclusions: "",
    lastRunAt: "",
  },
  channelVerifications: [],
  customProviders: [],
  jdIntakeItems: [],
  jobLeads: [],
  discoveryRunReceipts: [],
  discoveryReceiptCutoff: "",
  profile: {
    name: "林默",
    role: "前端 / AI 产品工程师",
    contact: "linmo@example.com · 上海",
    target: "AI 应用、开发者工具、前端平台",
    photoDataUrl: "",
    photoName: "",
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
        "岗位职责：负责 AI Agent 产品的前端架构与核心体验，使用 React、TypeScript 和现代前端工程化体系交付高质量功能；与产品、算法和设计团队紧密协作，理解大模型能力边界并推动 LLM 应用落地；建设可复用组件、复杂状态管理和质量保障体系，持续关注性能、稳定性与可维护性。任职要求：3 年以上前端开发经验，熟练掌握 React、TypeScript、浏览器原理和工程化工具；能够独立拆解复杂需求并推动跨团队交付；有 Electron、Node.js、开发者工具或 AI 产品经验优先；能够清晰说明技术方案、验证指标与取舍。",
      jdCompleteness: "full",
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
        "岗位职责：参与开发者工具与桌面端产品建设，主导 React、TypeScript、Electron 技术方案和系统设计；负责复杂编辑器、任务状态和跨端能力的产品化交付；推动性能监控、自动化测试、发布流程与前端工程规范建设；与产品和设计共同验证用户体验。任职要求：5 年左右前端开发经验，熟练掌握 React、TypeScript、Web 性能和复杂状态管理；能够独立完成架构设计、方案评审和问题排查；具备跨团队协作与书面沟通能力；有 Node.js、Monorepo、桌面端或 AI 辅助编程产品经验加分。",
      jdCompleteness: "full",
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
        "岗位职责：面向企业客户构建 LLM 应用与 Agent 工作流，负责从需求理解、原型验证到前端交付；与算法和业务团队共同设计 Prompt、检索增强、工具调用和效果评估流程；建设可观测、可回放的交互体验并持续分析失败案例；参与产品方案与客户需求评审。任职要求：熟悉 React、TypeScript、Node.js 及常见工程化方案；理解大模型应用的基本边界，能够设计验证样本和评估指标；具备较强的产品意识、用户体验判断和业务沟通能力；有企业软件、Agent 或模型评估项目经验优先。",
      jdCompleteness: "full",
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
    kind: "base",
    category: "前端 / AI 产品工程",
    baseResumeId: "",
    jobId: "",
    style: normalizeResumeStyle(),
    pdfExports: [],
    title: "",
    markdown: "",
    claimEvidence: [],
    notes: [],
    updatedAt: "",
  },
  versions: [],
  interviewSets: [
    {
      id: "iset-aurora",
      jobId: "job-aurora",
      sourceMode: "jd",
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
          kind: "evidence",
          evidence: "简历描述了性能与交付改善，但没有可核验的指标口径。",
          impact: "面试官可能继续追问影响范围与结果可信度。",
          priority: "high",
          actions: ["回查性能基线、时间窗口和可公开指标", "准备无法给精确值时的诚实表达"],
          practice: "用 90 秒说明一次性能改进，区分事实、区间和无法确认的数据。",
        },
        {
          area: "LLM 评估",
          kind: "skill",
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
      roadmap: [
        {
          phase: "第 1 阶段",
          title: "建立 LLM 评估基础框架",
          kind: "foundation",
          duration: "3 天",
          objective: "能够解释离线样本、质量指标、失败分类与人工反馈之间的关系。",
          tasks: ["整理当前项目已有评估逻辑", "补齐准确性、成本与延迟的基本口径"],
          deliverable: "一页 Agent 评估框架笔记",
          successCriteria: ["能在 3 分钟内说明评估闭环", "能举出一个失败分类示例"],
          status: "in_progress",
        },
        {
          phase: "第 2 阶段",
          title: "用真实功能完成一次评估实战",
          kind: "project",
          duration: "1 周",
          objective: "把理论落实为当前项目中可展示、可追问的评估案例。",
          tasks: ["选择一个 Agent 功能", "建立样本与基线", "记录失败、调整和复测结果"],
          deliverable: "可关联 Commit 与结果记录的项目案例",
          successCriteria: ["有可核验 Source", "能说明方案取舍与局限"],
          status: "planned",
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
    selectedBaseResumeId: "",
    workflowJobIds: [],
    workflowTaskIds: ["resume", "prepare"],
    activeView: "dashboard",
    discoveryPreferences: {
      keyword: "",
      location: "",
      seniority: "不限",
      count: 8,
      providers: ["boss", "linkedin", "official"],
      freshnessDays: 7,
      workMode: "any",
      exclusions: "",
      lastRunAt: "",
    },
    channelVerifications: [],
    customProviders: [],
    jdIntakeItems: [],
    jobLeads: [],
    discoveryRunReceipts: [],
    discoveryReceiptCutoff: "",
    profile: {
      name: "等待 Agent 识别",
      role: "当前项目",
      contact: "",
      target: "",
      summary: "",
      photoDataUrl: "",
      photoName: "",
    },
    jobs: [],
    repos: [],
    experiences: [],
    jobResearch: [],
    workflowRuns: [],
    resume: {
      kind: "base",
      category: "",
      baseResumeId: "",
      jobId: "",
      style: normalizeResumeStyle(),
      pdfExports: [],
      title: "",
      markdown: "",
      claimEvidence: [],
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
  topTraceCount: document.querySelector("#top-trace-count"),
  sideProfileAvatar: document.querySelector("#side-profile-avatar"),
  sideProfileName: document.querySelector("#side-profile-name"),
  sideProfileRole: document.querySelector("#side-profile-role"),
  jobNavCount: document.querySelector("#job-nav-count"),
  sourceNavCount: document.querySelector("#source-nav-count"),
  channelNavCount: document.querySelector("#channel-nav-count"),
  researchNavCount: document.querySelector("#research-nav-count"),
  resumeNavCount: document.querySelector("#resume-nav-count"),
  interviewNavCount: document.querySelector("#interview-nav-count"),
  allCount: document.querySelector("#all-count"),
  inboxCount: document.querySelector("#inbox-count"),
  savedCount: document.querySelector("#saved-count"),
  tailoringCount: document.querySelector("#tailoring-count"),
  appliedCount: document.querySelector("#applied-count"),
  interviewingCount: document.querySelector("#interviewing-count"),
  offerCount: document.querySelector("#offer-count"),
  closedCount: document.querySelector("#closed-count"),
  statJobs: document.querySelector("#stat-jobs"),
  statSourceDetail: document.querySelector("#stat-source-detail"),
  statMatch: document.querySelector("#stat-match"),
  statSources: document.querySelector("#stat-sources"),
  statNext: document.querySelector("#stat-next"),
  statNextDetail: document.querySelector("#stat-next-detail"),
  sourceWorkspaceName: document.querySelector("#source-workspace-name"),
  sourceWorkspaceState: document.querySelector("#source-workspace-state"),
  sourceProfileState: document.querySelector("#source-profile-state"),
  sourceExperienceState: document.querySelector("#source-experience-state"),
  sourceRepoState: document.querySelector("#source-repo-state"),
  sourceBaseState: document.querySelector("#source-base-state"),
  sourceChannelState: document.querySelector("#source-channel-state"),
  sourceJdState: document.querySelector("#source-jd-state"),
  sourceChannelEntry: document.querySelector("#source-channel-entry"),
  channelVerificationPanel: document.querySelector("#channel-verification-panel"),
  channelVerificationSummary: document.querySelector("#channel-verification-summary"),
  channelPageSummary: document.querySelector("#channel-page-summary"),
  channelVerificationList: document.querySelector("#channel-verification-list"),
  showAddChannel: document.querySelector("#show-add-channel"),
  addChannelForm: document.querySelector("#add-channel-form"),
  customChannelName: document.querySelector("#custom-channel-name"),
  customChannelUrl: document.querySelector("#custom-channel-url"),
  cancelAddChannel: document.querySelector("#cancel-add-channel"),
  addChannelError: document.querySelector("#add-channel-error"),
  discoveryAutomationPanel: document.querySelector("#discovery-automation-panel"),
  discoveryAutomationStatus: document.querySelector("#discovery-automation-status"),
  discoveryAutomationForm: document.querySelector("#discovery-automation-form"),
  discoveryAutomationFrequency: document.querySelector("#discovery-automation-frequency"),
  discoveryAutomationTime: document.querySelector("#discovery-automation-time"),
  discoveryAutomationCount: document.querySelector("#discovery-automation-count"),
  saveDiscoveryAutomation: document.querySelector("#save-discovery-automation"),
  discoveryAutomationActions: document.querySelector("#discovery-automation-actions"),
  toggleDiscoveryAutomation: document.querySelector("#toggle-discovery-automation"),
  runDiscoveryAutomation: document.querySelector("#run-discovery-automation"),
  deleteDiscoveryAutomation: document.querySelector("#delete-discovery-automation"),
  discoveryAutomationDetail: document.querySelector("#discovery-automation-detail"),
  jdInboxPanel: document.querySelector("#jd-inbox-panel"),
  jdInboxTotal: document.querySelector("#jd-inbox-total"),
  jdInboxPending: document.querySelector("#jd-inbox-pending"),
  jdInboxImported: document.querySelector("#jd-inbox-imported"),
  jdInboxAttention: document.querySelector("#jd-inbox-attention"),
  jdIntakeList: document.querySelector("#jd-intake-list"),
  addJdIntake: document.querySelector("#add-jd-intake"),
  scanJdInbox: document.querySelector("#scan-jd-inbox"),
  jobList: document.querySelector("#job-list"),
  jobLeadsPanel: document.querySelector("#job-leads-panel"),
  jobLeadCount: document.querySelector("#job-lead-count"),
  jobLeadList: document.querySelector("#job-lead-list"),
  jobSearchQuery: document.querySelector("#job-search-query"),
  jobSort: document.querySelector("#job-sort"),
  jobSourceFilter: document.querySelector("#job-source-filter"),
  emptyAddJob: document.querySelector("#empty-add-job"),
  jobDetailHeaderState: document.querySelector("#job-detail-header-state"),
  jobDetailEmpty: document.querySelector("#job-detail-empty"),
  jobDetailContent: document.querySelector("#job-detail-content"),
  jobDetailCompany: document.querySelector("#job-detail-company"),
  jobDetailStatus: document.querySelector("#job-detail-status"),
  jobDetailTitle: document.querySelector("#job-detail-title"),
  jobDetailMeta: document.querySelector("#job-detail-meta"),
  jobDetailBadges: document.querySelector("#job-detail-badges"),
  jobDetailLength: document.querySelector("#job-detail-length"),
  jobDetailDescription: document.querySelector("#job-detail-description"),
  jobDetailVerification: document.querySelector("#job-detail-verification"),
  jobDetailTriage: document.querySelector("#job-detail-triage"),
  jobDetailInterest: document.querySelector("#job-detail-interest"),
  jobDetailIgnore: document.querySelector("#job-detail-ignore"),
  deleteJob: document.querySelector("#delete-job"),
  deleteJobTarget: document.querySelector("#delete-job-target"),
  deleteJobImpactSummary: document.querySelector("#delete-job-impact-summary"),
  confirmDeleteJob: document.querySelector("#confirm-delete-job"),
  jobDetailTrace: document.querySelector("#job-detail-trace"),
  resumeTitle: document.querySelector("#resume-title"),
  resumeKindLabel: document.querySelector("#resume-kind-label"),
  resumeJobLabel: document.querySelector("#resume-job-label"),
  resumeUpdated: document.querySelector("#resume-updated"),
  resumeExportStatus: document.querySelector("#resume-export-status"),
  resumeEvidenceLedger: document.querySelector("#resume-evidence-ledger"),
  resumeEvidenceCoverage: document.querySelector("#resume-evidence-coverage"),
  resumeEvidenceSummary: document.querySelector("#resume-evidence-summary"),
  resumeEvidenceList: document.querySelector("#resume-evidence-list"),
  resumePreview: document.querySelector("#resume-preview"),
  resumeEditor: document.querySelector("#resume-editor"),
  jdPreview: document.querySelector("#jd-preview"),
  resumeCategory: document.querySelector("#resume-category"),
  baseResumeSelect: document.querySelector("#base-resume-select"),
  resumeTemplateSelect: document.querySelector("#resume-template-select"),
  resumeDensitySelect: document.querySelector("#resume-density-select"),
  generateResume: document.querySelector("#generate-resume"),
  tailorResume: document.querySelector("#tailor-resume"),
  resumePhotoInput: document.querySelector("#resume-photo-input"),
  removeResumePhoto: document.querySelector("#remove-resume-photo"),
  saveResume: document.querySelector("#save-resume"),
  printResume: document.querySelector("#print-resume"),
  resumeTrace: document.querySelector("#resume-trace"),
  resumePrintRoot: document.querySelector("#resume-print-root"),
  matchScore: document.querySelector("#match-score"),
  keywordCount: document.querySelector("#keyword-count"),
  keywordList: document.querySelector("#keyword-list"),
  coverageLabel: document.querySelector("#coverage-label"),
  coverageList: document.querySelector("#coverage-list"),
  openSourceJob: document.querySelector("#open-source-job"),
  applicationStage: document.querySelector("#application-stage"),
  applicationStageUpdated: document.querySelector("#application-stage-updated"),
  applicationNextAction: document.querySelector("#application-next-action"),
  applicationNextActionAt: document.querySelector("#application-next-action-at"),
  applicationNote: document.querySelector("#application-note"),
  updateApplication: document.querySelector("#update-application"),
  applicationHistory: document.querySelector("#application-history"),
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
  projectSnapshotError: document.querySelector("#project-snapshot-error"),
  saveProjectSnapshot: document.querySelector("#save-project-snapshot"),
  initializeJobHuntProject: document.querySelector("#initialize-job-hunt-project"),
  projectBootstrapSummary: document.querySelector("#project-bootstrap-summary"),
  projectBootstrapTitle: document.querySelector("#project-bootstrap-title"),
  projectBootstrapDetail: document.querySelector("#project-bootstrap-detail"),
  dashboardProjectBootstrap: document.querySelector("#dashboard-project-bootstrap"),
  dashboardFocusKicker: document.querySelector("#dashboard-focus-kicker"),
  dashboardProjectBootstrapTitle: document.querySelector("#dashboard-project-bootstrap-title"),
  dashboardProjectBootstrapDetail: document.querySelector("#dashboard-project-bootstrap-detail"),
  dashboardInitializeProject: document.querySelector("#dashboard-initialize-project"),
  dashboardFocusSecondary: document.querySelector("#dashboard-focus-secondary"),
  searchProjectPreflight: document.querySelector("#search-project-preflight"),
  searchProjectPreflightStatus: document.querySelector("#search-project-preflight-status"),
  searchProjectPreflightDetail: document.querySelector("#search-project-preflight-detail"),
  searchLoginPreflight: document.querySelector("#search-login-preflight"),
  searchLoginPreflightStatus: document.querySelector("#search-login-preflight-status"),
  searchLoginPreflightDetail: document.querySelector("#search-login-preflight-detail"),
  searchPreflightInitialize: document.querySelector("#search-preflight-initialize"),
  searchVerifyChannels: document.querySelector("#search-verify-channels"),
  providerPicker: document.querySelector("#provider-picker"),
  submitJobSearch: document.querySelector("#submit-job-search"),
  intakeSearchSites: document.querySelector("#intake-search-sites"),
  intakeImportMessage: document.querySelector("#intake-import-message"),
  intakeProjectFiles: document.querySelector("#intake-project-files"),
  jdIntakeSource: document.querySelector("#jd-intake-source"),
  jdIntakeUrl: document.querySelector("#jd-intake-url"),
  jdIntakeText: document.querySelector("#jd-intake-text"),
  jdFileDropzone: document.querySelector("#jd-file-dropzone"),
  jdFileInput: document.querySelector("#jd-file-input"),
  chooseJdFiles: document.querySelector("#choose-jd-files"),
  jdFileSelection: document.querySelector("#jd-file-selection"),
  submitJdIntake: document.querySelector("#submit-jd-intake"),
  flowMaterialsDetail: document.querySelector("#flow-materials-detail"),
  flowMaterialsState: document.querySelector("#flow-materials-state"),
  flowBaseDetail: document.querySelector("#flow-base-detail"),
  flowBaseState: document.querySelector("#flow-base-state"),
  flowInboxDetail: document.querySelector("#flow-inbox-detail"),
  flowInboxState: document.querySelector("#flow-inbox-state"),
  flowPreparationDetail: document.querySelector("#flow-preparation-detail"),
  flowPreparationState: document.querySelector("#flow-preparation-state"),
  flowFollowupDetail: document.querySelector("#flow-followup-detail"),
  flowFollowupState: document.querySelector("#flow-followup-state"),
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
  workflowDisclosure: document.querySelector("#workflow-disclosure"),
  workflowBuilderTitle: document.querySelector("#workflow-builder-title"),
  workflowBuilderDescription: document.querySelector("#workflow-builder-description"),
  workflowJobPicker: document.querySelector("#workflow-job-picker"),
  workflowTaskPicker: document.querySelector("#workflow-task-picker"),
  workflowSelectionSummary: document.querySelector("#workflow-selection-summary"),
  runCustomWorkflow: document.querySelector("#run-custom-workflow"),
  opportunitiesTitle: document.querySelector("#opportunities-title"),
  opportunitiesSummary: document.querySelector("#opportunities-summary"),
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
  generateCommitInterview: document.querySelector("#generate-commit-interview"),
  preparationTitle: document.querySelector("#preparation-title"),
  preparationSummary: document.querySelector("#preparation-summary"),
  preparationStrengths: document.querySelector("#preparation-strengths"),
  preparationGapSummary: document.querySelector("#preparation-gap-summary"),
  preparationGapList: document.querySelector("#preparation-gap-list"),
  preparationRoadmapCount: document.querySelector("#preparation-roadmap-count"),
  preparationRoadmapList: document.querySelector("#preparation-roadmap-list"),
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
  sessionInstructionCount: document.querySelector("#session-instruction-count"),
  sessionPromptPreview: document.querySelector("#session-prompt-preview"),
  sessionActivityCount: document.querySelector("#session-activity-count"),
  sessionTraceRunCount: document.querySelector("#session-trace-run-count"),
  sessionTraceSuccessRate: document.querySelector("#session-trace-success-rate"),
  sessionTraceAverageDuration: document.querySelector("#session-trace-average-duration"),
  sessionTraceAttentionCount: document.querySelector("#session-trace-attention-count"),
  sessionTraceFilters: document.querySelector("#session-trace-filters"),
  sessionActivityList: document.querySelector("#session-activity-list"),
  sessionBridgeState: document.querySelector("#session-bridge-state"),
  sessionBridgeStateLabel: document.querySelector("#session-bridge-state-label"),
  sendSessionInstruction: document.querySelector("#send-session-instruction"),
  discussJobSession: document.querySelector("#discuss-job-session"),
  continueResumeSession: document.querySelector("#continue-resume-session"),
  resetJobHuntProject: document.querySelector("#reset-job-hunt-project"),
  confirmResetJobHunt: document.querySelector("#confirm-reset-job-hunt"),
  toast: document.querySelector("#toast"),
};

const resumeWorkspaceSlot = document.querySelector("#resume-workspace-slot");
const resumeWorkspacePanel = document.querySelector(".resume-panel");
if (resumeWorkspaceSlot && resumeWorkspacePanel) {
  resumeWorkspaceSlot.append(resumeWorkspacePanel);
}

const materialsSourceOverviewSlot = document.querySelector("#materials-source-overview-slot");
const sourceOverviewPanel = document.querySelector(".source-overview");
if (materialsSourceOverviewSlot && sourceOverviewPanel) {
  materialsSourceOverviewSlot.append(sourceOverviewPanel);
}

let state = structuredClone(seedState);
let context = { cwd: null, trusted: false, busy: false, apiVersion: 0, sessionId: "" };
const projectContext = {
  name: "当前项目",
  hasCodeshellFile: false,
  hasSnapshot: false,
  lastSyncedAt: "",
  snapshotDirty: false,
  snapshotError: "",
  snapshotUnreadable: false,
};
let resumeMode = "preview";
let jobSearchQuery = "";
let jobSort = "added";
let toastTimer = null;
let saveTimer = null;
let projectSnapshotTimer = null;
let projectSnapshotSaveQueue = Promise.resolve(false);
let sessionSubmissionPending = false;
let activeChannelVerificationProviderId = "";
let activeChannelLoginProviderId = "";
const channelCookieAccounts = new Map();
const channelCookieAccountLoads = new Map();
let previewAutomations = [];
let discoveryAutomation = null;
let discoveryAutomationLoaded = false;
let discoveryAutomationLoading = false;
let discoveryAutomationActionPending = false;
let scheduledReceiptImportPending = false;
let pendingDeleteJobId = "";
let pendingJdFiles = [];
let jdIntakeSubmissionPending = false;
let activeJdIntakeIds = [];
let activeSessionTraceId = "";
let focusedSessionTraceId = "";
let sessionBridgeParentTraceId = "";
let resumePrintCleanupTimer = null;
let sessionBridgeContext = {
  kind: "panel",
  title: "当前求职面板",
  detail: "Agent 会读取当前项目、岗位和面板中的最新结构化数据。",
  payload: {},
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function providerCatalog(customProviders = state.customProviders) {
  return [...JOB_PROVIDERS, ...(Array.isArray(customProviders) ? customProviders : [])];
}

function providerById(providerId, customProviders = state.customProviders) {
  return (
    PROVIDER_BY_ID.get(providerId) ||
    (Array.isArray(customProviders)
      ? customProviders.find((provider) => provider.id === providerId)
      : null)
  );
}

function validProviderIds(customProviders = state.customProviders) {
  return providerCatalog(customProviders).map((provider) => provider.id);
}

function normalizeSourceId(sourceId, sourceLabel = "") {
  const explicit = String(sourceId || "")
    .trim()
    .toLowerCase();
  if (providerById(explicit)) return explicit;
  const label = String(sourceLabel || "").toLowerCase();
  const manualSource = MANUAL_SOURCE_RULES.find((source) =>
    source.tokens.some((token) => label.includes(token)),
  );
  if (manualSource) return manualSource.id;
  return (
    providerCatalog().find(
      (provider) =>
        label.includes(provider.id) ||
        label.includes(provider.label.toLowerCase()) ||
        label.includes(provider.domain.split("/")[0]),
    )?.id ?? "other"
  );
}

function providerLabel(sourceId, fallback = "") {
  return providerById(sourceId)?.label || fallback || "其他";
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
  next.customProviders = normalizeCustomProviders(input.customProviders, {
    reservedProviderIds: JOB_PROVIDERS.map((provider) => provider.id),
  });
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
    "sessionActivity",
    "channelVerifications",
    "jdIntakeItems",
    "jobLeads",
    "discoveryRunReceipts",
  ]) {
    if (Array.isArray(input[field])) next[field] = input[field];
  }
  if (input.resume && typeof input.resume === "object") {
    next.resume = { ...next.resume, ...input.resume };
  }
  if (typeof input.selectedBaseResumeId === "string") {
    next.selectedBaseResumeId = input.selectedBaseResumeId.slice(0, 100);
  }
  if (typeof input.discoveryReceiptCutoff === "string") {
    next.discoveryReceiptCutoff = cleanText(input.discoveryReceiptCutoff, 80);
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
  if (
    typeof input.statusFilter === "string" &&
    ["all", "active", ...APPLICATION_STAGE_IDS, "interview", "closed"].includes(input.statusFilter)
  ) {
    next.statusFilter = input.statusFilter;
  }
  if (typeof input.jobFilter === "string") next.jobFilter = input.jobFilter;
  if (typeof input.jobSourceFilter === "string") {
    next.jobSourceFilter = input.jobSourceFilter;
  }
  if (typeof input.interviewCategoryFilter === "string") {
    next.interviewCategoryFilter = input.interviewCategoryFilter;
  }
  if (["all", "running", "completed", "partial", "failed"].includes(input.sessionTraceFilter)) {
    next.sessionTraceFilter = input.sessionTraceFilter;
  }
  next.discoveryPreferences = normalizeDiscoveryPreferences(
    input.discoveryPreferences ?? next.discoveryPreferences,
    {
      profile: next.profile,
      validProviderIds: validProviderIds(next.customProviders),
    },
  );
  next.channelVerifications = normalizeChannelVerifications(
    next.channelVerifications,
    validProviderIds(next.customProviders),
  );
  next.jdIntakeItems = normalizeJdIntakeItems(next.jdIntakeItems);
  next.discoveryRunReceipts = next.discoveryRunReceipts
    .filter((receipt) => receipt && typeof receipt === "object")
    .map((receipt) => ({
      id: cleanText(receipt.id, 160),
      path: cleanText(receipt.path, 1000),
      importedAt: cleanText(receipt.importedAt, 80),
      formalCount: Math.max(0, Number(receipt.formalCount) || 0),
      leadCount: Math.max(0, Number(receipt.leadCount) || 0),
      error: cleanText(receipt.error, 300),
    }))
    .filter((receipt) => receipt.id && receipt.path)
    .slice(-100);
  if (next.jobFilter === "boss") {
    next.jobFilter = "all";
    next.jobSourceFilter = "boss";
  }
  const normalizedJobs = next.jobs.map((job) =>
    normalizeJobApplication({
      ...job,
      sourceId: normalizeSourceId(job.sourceId, job.source),
      jdCompleteness: normalizeJdCompleteness(
        job.jdCompleteness,
        job.description,
        true,
      ),
      verificationNotes: cleanText(job.verificationNotes, 2000),
      fetchedAt: cleanText(job.fetchedAt, 80),
    }),
  );
  const normalizedLeads = next.jobLeads.map((lead) => ({
    ...lead,
    id: cleanText(lead.id, 100) || uid("job-lead"),
    company: cleanText(lead.company, 80),
    title: cleanText(lead.title, 120),
    sourceId: normalizeSourceId(lead.sourceId, lead.source),
    jdCompleteness: normalizeJdCompleteness(
      lead.jdCompleteness,
      lead.description,
    ),
    missingFields: cleanTextList(lead.missingFields, 8, 120),
    evidenceGaps: cleanTextList(lead.evidenceGaps, 8, 120),
    status: "lead",
  }));
  const partitionedJobs = upsertJobDiscovery([], normalizedLeads, normalizedJobs, {
    dedupeKey: jobDedupeKey,
    metadataKey: jobMetadataKey,
  });
  next.jobs = partitionedJobs.jobs;
  next.jobLeads = partitionedJobs.leads;
  if (!next.jobs.some((job) => job.id === next.selectedJobId)) {
    next.selectedJobId = next.jobs[0]?.id ?? "";
  }
  next.workflowJobIds = next.workflowJobIds.filter((id) =>
    next.jobs.some((job) => job.id === id),
  );
  if (!next.interviewSets.some((set) => set.id === next.selectedInterviewSetId)) {
    next.selectedInterviewSetId = next.interviewSets[0]?.id ?? "";
  }
  next.profile.photoDataUrl = isSupportedResumePhoto(next.profile.photoDataUrl)
    ? next.profile.photoDataUrl
    : "";
  next.profile.photoName = cleanText(next.profile.photoName, 160);
  const resumeOptions = {
    profileTarget: next.profile.target,
    profileRole: next.profile.role,
  };
  next.resume = normalizeResumeRecord(next.resume, resumeOptions);
  next.versions = next.versions.map((version) =>
    normalizeResumeRecord(version, resumeOptions),
  );
  const selectedBase = selectBaseResume(
    collectResumeRecords(next.resume, next.versions, resumeOptions),
    next.selectedBaseResumeId,
  );
  next.selectedBaseResumeId = selectedBase ? resumeRecordId(selectedBase) : "";
  next.sessionActivity = next.sessionActivity
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      id: cleanText(item.id, 100) || uid("session"),
      target:
        item.target && typeof item.target === "object" && !Array.isArray(item.target)
          ? {
              kind: cleanText(item.target.kind, 40) || "panel",
              title: cleanText(item.target.title, 500) || "当前求职面板",
              detail: cleanText(item.target.detail, 1000),
              payload:
                item.target.payload &&
                typeof item.target.payload === "object" &&
                !Array.isArray(item.target.payload)
                  ? item.target.payload
                  : {},
            }
          : {
              kind: "panel",
              title: "当前求职面板",
              detail: "",
              payload: {},
            },
      instruction: cleanText(item.instruction, 2000),
      requestPrompt: cleanText(item.requestPrompt, 30000),
      parentTraceId: cleanText(item.parentTraceId, 100),
      workspace: cleanText(item.workspace, 2000),
      status: ["submitted", "running", "completed", "partial", "failed"].includes(item.status)
        ? item.status
        : "submitted",
      outcome:
        item.outcome && typeof item.outcome === "object" && !Array.isArray(item.outcome)
          ? {
              status: ["completed", "partial", "failed"].includes(item.outcome.status)
                ? item.outcome.status
                : "completed",
              summary: cleanText(item.outcome.summary, 2000),
              outputRefs: cleanTextList(item.outcome.outputRefs, 12, 500),
              error: cleanText(item.outcome.error, 2000),
              completedAt: cleanText(item.outcome.completedAt, 80),
            }
          : null,
      artifacts: Array.isArray(item.artifacts)
        ? item.artifacts
            .filter((artifact) => artifact && typeof artifact === "object")
            .map((artifact) => ({
              kind: cleanText(artifact.kind, 40) || "artifact",
              id: cleanText(artifact.id, 120),
              label: cleanText(artifact.label, 160),
            }))
            .filter((artifact) => artifact.id)
            .slice(0, 12)
        : [],
      events: Array.isArray(item.events)
        ? item.events
            .filter((event) => event && typeof event === "object")
            .map((event) => ({
              id: cleanText(event.id, 100) || uid("event"),
              kind: [
                "submitted",
                "running",
                "stage",
                "source",
                "warning",
                "feedback",
                "artifact",
                "completed",
                "partial",
                "failed",
              ].includes(event.kind)
                ? event.kind
                : "running",
              label: cleanText(event.label, 160),
              detail: cleanText(event.detail, 1000),
              at: cleanText(event.at, 80),
            }))
            .filter((event) => event.label)
            .slice(-40)
        : [],
      createdAt: cleanText(item.createdAt, 80),
      startedAt: cleanText(item.startedAt, 80),
      completedAt: cleanText(item.completedAt, 80),
      updatedAt: cleanText(item.updatedAt, 80),
      feedback: Object.hasOwn(TRACE_FEEDBACK_LABELS, item.feedback) ? item.feedback : "",
    }))
    .filter((item) => item.instruction)
    .slice(0, 24);
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
  if (method === "credentials.cookies.list") return Promise.resolve({ accounts: [] });
  if (method === "credentials.cookies.loginAndSave") {
    return Promise.resolve({ ok: false, cancelled: true });
  }
  if (method === "credentials.cookies.restore") {
    return Promise.resolve({ restored: false, cancelled: true });
  }
  if (method === "automations.list") {
    return Promise.resolve({ automations: clone(previewAutomations) });
  }
  if (method === "automations.create") {
    const automation = {
      id: uid("automation"),
      name: params.name,
      schedule: params.schedule,
      prompt: params.prompt,
      enabled: true,
      cwd: "/preview/codeshell",
      timezone: params.timezone || "Asia/Singapore",
      permissionLevel: "full",
      lastRun: null,
      nextRun: Date.now() + 86_400_000,
      runCount: 0,
      resumeSessionId: "preview-session",
    };
    previewAutomations = [...previewAutomations, automation];
    return Promise.resolve(clone(automation));
  }
  if (method === "automations.update") {
    previewAutomations = previewAutomations.map((item) =>
      item.id === params.id ? { ...item, ...params } : item,
    );
    return Promise.resolve(clone(previewAutomations.find((item) => item.id === params.id)));
  }
  if (["automations.pause", "automations.resume"].includes(method)) {
    previewAutomations = previewAutomations.map((item) =>
      item.id === params.id
        ? { ...item, enabled: method === "automations.resume" }
        : item,
    );
    return Promise.resolve({ ok: true });
  }
  if (method === "automations.delete") {
    previewAutomations = previewAutomations.filter((item) => item.id !== params.id);
    return Promise.resolve({ ok: true });
  }
  if (method === "automations.runNow") return Promise.resolve({ ok: true });
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
    apiVersion: 5,
  });
}

function updateContext(next) {
  const wasBusy = Boolean(context.busy);
  const previousCwd = context.cwd;
  const previousSessionId = context.sessionId;
  const bootstrapTrace = wasBusy
    ? state.sessionActivity.find((item) => item.id === activeSessionTraceId) || activeTrace()
    : null;
  context = { ...context, ...(next ?? {}) };
  if (context.cwd !== previousCwd) {
    channelCookieAccounts.clear();
    channelCookieAccountLoads.clear();
  }
  if (context.cwd !== previousCwd || context.sessionId !== previousSessionId) {
    discoveryAutomation = null;
    discoveryAutomationLoaded = false;
  }
  if (wasBusy && !context.busy && activeChannelVerificationProviderId) {
    const incomplete = channelVerification(activeChannelVerificationProviderId);
    if (incomplete.state === "checking") {
      updateChannelVerification(
        activeChannelVerificationProviderId,
        "unavailable",
        "本次验证没有返回明确结果，请重新验证",
      );
      persist();
      void writeProjectSnapshot();
    }
    activeChannelVerificationProviderId = "";
  }
  if (wasBusy && !context.busy && activeJdIntakeIds.length) {
    const incomplete = new Set(activeJdIntakeIds);
    state.jdIntakeItems = state.jdIntakeItems.map((item) =>
      incomplete.has(item.id) && item.status === "processing"
        ? {
            ...item,
            status: "failed",
            updatedAt: new Date().toISOString(),
            error: "本次识别没有写回导入结果，可以点击“重新识别”",
          }
        : item,
    );
    activeJdIntakeIds = [];
    persist();
    void writeProjectSnapshot();
  }
  syncActiveTraceLifecycle(wasBusy, Boolean(context.busy));
  if (wasBusy && !context.busy) activeSessionTraceId = "";
  const name = context.cwd ? context.cwd.split(/[\\/]/).filter(Boolean).at(-1) : "浏览器预览";
  elements.workspaceLabel.textContent = `${name || "未绑定项目"}${context.busy ? " · Agent 忙碌中" : " · 已连接"}`;
  elements.generateResume.disabled = Boolean(context.busy);
  elements.tailorResume.disabled =
    Boolean(context.busy) ||
    !isWorkflowEligibleStage(selectedJob()?.status) ||
    !selectedBaseResume();
  elements.askAgent.disabled = Boolean(context.busy) || !selectedJob();
  elements.simulateInterview.disabled = Boolean(context.busy) || !selectedInterviewSet();
  elements.regenerateInterview.disabled =
    Boolean(context.busy) || !isWorkflowEligibleStage(selectedJob()?.status);
  elements.generateCommitInterview.disabled = Boolean(context.busy);
  elements.runCustomWorkflow.disabled =
    Boolean(context.busy) ||
    state.workflowTaskIds.length === 0 ||
    workflowMissingJobTasks().length > 0;
  elements.runCompanyResearch.disabled =
    Boolean(context.busy) || !isWorkflowEligibleStage(selectedJob()?.status);
  elements.refreshPreparationPlan.disabled = Boolean(context.busy);
  elements.startInterviewDebrief.disabled = Boolean(context.busy);
  elements.sendSessionInstruction.disabled =
    Boolean(context.busy) || sessionSubmissionPending;
  elements.submitJdIntake.disabled =
    Boolean(context.busy) || jdIntakeSubmissionPending;
  elements.sessionBridgeState.classList.toggle(
    "busy",
    Boolean(context.busy) || sessionSubmissionPending,
  );
  elements.sessionBridgeStateLabel.textContent = context.busy
    ? " 当前 Session 正在处理任务"
    : sessionSubmissionPending
      ? " 正在提交到当前 Session"
    : " 已绑定当前 Session";
  elements.projectSessionState.textContent = context.sessionId
    ? context.busy
      ? "当前 Session · Agent 执行中"
      : "已绑定当前 Session"
    : "浏览器预览";
  renderJobPoolDetail(selectedJob());
  renderMaterials();
  if (
    wasBusy &&
    !context.busy &&
    bootstrapTrace?.target?.kind === "project-bootstrap"
  ) {
    void syncProjectContext({ quiet: true });
  }
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function selectedJob() {
  return state.jobs.find((job) => job.id === state.selectedJobId) ?? null;
}

function resumeRecords() {
  return collectResumeRecords(state.resume, state.versions, {
    profileTarget: state.profile.target,
    profileRole: state.profile.role,
  });
}

function baseResumes() {
  return baseResumeRecords(resumeRecords());
}

function selectedBaseResume() {
  return selectBaseResume(resumeRecords(), state.selectedBaseResumeId);
}

function activeResumeJob() {
  return state.resume.kind === "variant"
    ? state.jobs.find((job) => job.id === state.resume.jobId) ?? null
    : null;
}

function selectedInterviewSet() {
  return state.interviewSets.find((set) => set.id === state.selectedInterviewSetId) ?? null;
}

function selectedWorkflowJobs() {
  return state.jobs.filter(
    (job) => state.workflowJobIds.includes(job.id) && isWorkflowEligibleStage(job.status),
  );
}

function workflowEligibleJobs() {
  return state.jobs.filter((job) => isWorkflowEligibleStage(job.status));
}

function workflowMissingJobTasks() {
  if (selectedWorkflowJobs().length) return [];
  return state.workflowTaskIds.filter((id) => WORKFLOW_TASKS[id]?.requiresJob);
}

function currentProjectBootstrapStatus() {
  return resolveProjectBootstrapStatus({
    snapshotUnreadable: projectContext.snapshotUnreadable,
    hasCodeshellFile: projectContext.hasCodeshellFile,
    hasSnapshot: projectContext.hasSnapshot,
    profile: state.profile,
    repositories: state.repos,
    experiences: state.experiences,
    resumeMarkdown: state.resume.markdown,
  });
}

function setCareerFlowStep(action, flowState, label) {
  const button = document.querySelector(`[data-career-flow-action="${action}"]`);
  if (!button) return;
  button.dataset.state = flowState;
  const elementPrefix = action === "discover" ? "Discovery" : `${action[0].toUpperCase()}${action.slice(1)}`;
  const stateLabel = elements[`flow${elementPrefix}State`];
  if (stateLabel) stateLabel.textContent = label;
}

function renderCareerFlow(bootstrap) {
  const inboxCount = state.jobs.filter((job) => job.status === "inbox").length;
  const eligibleJobs = workflowEligibleJobs();
  const followupJobs = state.jobs.filter((job) =>
    ["applied", "screening", "interviewing", "offer"].includes(job.status),
  );
  const baseCount = baseResumes().length;
  const preparationArtifactCount =
    state.jobResearch.length +
    state.interviewSets.length +
    state.preparationPlans.filter((plan) => plan.jobId).length +
    resumeRecords().filter((resume) => resume.kind === "variant").length;
  const currentStep = resolveCareerCurrentStep({
    projectReady: bootstrap.state === "ready",
    hasBase: baseCount > 0,
    totalJobs: state.jobs.length,
    inboxCount,
    eligibleCount: eligibleJobs.length,
    followupCount: followupJobs.length,
  });

  elements.flowMaterialsDetail.textContent = `${state.experiences.length} 段经历 · ${state.repos.length} 个 Repo`;
  elements.flowBaseDetail.textContent = `${baseCount} 份基础简历`;
  elements.flowInboxDetail.textContent = `${state.jobs.length} 个完整 JD · ${state.jobLeads.length} 条线索`;
  elements.flowPreparationDetail.textContent = `${eligibleJobs.length} 个关注 · ${preparationArtifactCount} 份产物`;
  elements.flowFollowupDetail.textContent = `${followupJobs.length} 个进行中 · ${state.interviewDebriefs.length} 次复盘`;

  setCareerFlowStep(
    "materials",
    currentStep === "materials" ? "current" : "done",
    bootstrap.state === "ready" ? "已确认" : "当前一步",
  );
  setCareerFlowStep(
    "base",
    currentStep === "base" ? "current" : baseCount ? "done" : "pending",
    currentStep === "base" ? "当前一步" : baseCount ? "已建立" : "待数据源",
  );
  setCareerFlowStep(
    "inbox",
    currentStep === "inbox" ? "current" : state.jobs.length && !inboxCount ? "done" : "pending",
    inboxCount ? "需要判断" : state.jobs.length ? "已处理" : "待收集",
  );
  setCareerFlowStep(
    "preparation",
    currentStep === "preparation" ? "current" : followupJobs.length ? "done" : "pending",
    currentStep === "preparation"
      ? "当前一步"
      : followupJobs.length
        ? "已进入投递"
        : "待选岗位",
  );
  setCareerFlowStep(
    "followup",
    currentStep === "followup" ? "current" : "pending",
    currentStep === "followup" ? "持续跟进" : "尚未投递",
  );
}

function nextApplicationItem() {
  return workflowEligibleJobs()
    .map((job) => ({ job, application: normalizeJobApplication(job).application }))
    .filter((item) => item.application.nextAction)
    .sort((left, right) => {
      const leftParsed = new Date(left.application.nextActionAt || "").getTime();
      const rightParsed = new Date(right.application.nextActionAt || "").getTime();
      const leftTime = Number.isFinite(leftParsed) ? leftParsed : Number.MAX_SAFE_INTEGER;
      const rightTime = Number.isFinite(rightParsed) ? rightParsed : Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    })[0];
}

function renderDashboardFocus(bootstrap) {
  const inboxCount = state.jobs.filter((job) => job.status === "inbox").length;
  const eligibleJobs = workflowEligibleJobs();
  const selectedJobs = selectedWorkflowJobs();
  const missingJobTasks = workflowMissingJobTasks();
  const nextApplication = nextApplicationItem();
  const focusKind = resolveDashboardFocusKind({
    bootstrapState: bootstrap.state,
    hasBase: Boolean(selectedBaseResume()),
    inboxCount,
    hasNextApplication: Boolean(nextApplication),
    eligibleCount: eligibleJobs.length,
    selectedCount: selectedJobs.length,
    selectedTaskCount: state.workflowTaskIds.length,
    missingJobTaskCount: missingJobTasks.length,
  });
  let model;

  if (focusKind === "project") {
    model = {
      state: bootstrap.state,
      kicker: "DATA SOURCE FOUNDATION",
      title: bootstrap.title,
      detail: bootstrap.detail,
      primaryLabel: bootstrap.button,
      primaryAction: "initialize",
      secondaryLabel: "查看数据源",
      secondaryAction: "materials",
    };
  } else if (focusKind === "foundation") {
    model = {
      state: "foundation",
      kicker: "RESUME FOUNDATION",
      title: "先建立一份方向级 Base Resume",
      detail: "先把经历、项目和真实证据打稳，之后的 JD 定制版都从这份基础简历派生。",
      primaryLabel: "✦ 生成 Base Resume",
      primaryAction: "base",
      secondaryLabel: "检查数据源",
      secondaryAction: "materials",
    };
  } else if (focusKind === "inbox") {
    model = {
      state: "inbox",
      kicker: "TRIAGE INBOX",
      title: `先判断 ${inboxCount} 个新岗位是否值得准备`,
      detail: "看 JD 不等于要投。标记感兴趣后才会进入简历、公司调研、题库和学习计划。",
      primaryLabel: `筛选 ${inboxCount} 个岗位`,
      primaryAction: "inbox",
      secondaryLabel: "继续找岗位",
      secondaryAction: "discover",
    };
  } else if (focusKind === "followup") {
    model = {
      state: "followup",
      kicker: "APPLICATION FOLLOW-UP",
      title: nextApplication.application.nextAction,
      detail: `${nextApplication.job.company} · ${nextApplication.job.title}${
        nextApplication.application.nextActionAt
          ? ` · ${nextApplication.application.nextActionAt.slice(0, 10)}`
          : ""
      }`,
      primaryLabel: "查看岗位进度",
      primaryAction: "job",
      jobId: nextApplication.job.id,
      secondaryLabel: "组合准备任务",
      secondaryAction: "compose",
    };
  } else if (focusKind === "discovery") {
    model = {
      state: "discovery",
      kicker: "JOB DISCOVERY",
      title: "拉一批岗位进入待筛选收件箱",
      detail: "Agent 按当前方向搜索公开岗位；抓回来的 JD 只用于你判断，不会自动开始准备。",
      primaryLabel: "✦ 找一批岗位",
      primaryAction: "discover",
      secondaryLabel: "手动导入 JD",
      secondaryAction: "import",
    };
  } else if (focusKind === "compose") {
    model = {
      state: "prepare",
      kicker: "CHOOSE PREPARATION SCOPE",
      title: !selectedJobs.length
        ? "从关注岗位中选择本次要准备的对象"
        : !state.workflowTaskIds.length
          ? "为已选岗位选择本次要执行的任务"
          : "这组任务还缺岗位上下文",
      detail: missingJobTasks.length
        ? `${missingJobTasks.map((id) => WORKFLOW_TASKS[id].label).join("、")} 需要先选择岗位。`
        : !state.workflowTaskIds.length
          ? "可以从简历、匹配分析、公司面经、题库、补强计划或模拟面试中自由组合。"
        : "可以多选岗位，然后按这次的需要勾选简历、调研、题库或补强计划。",
      primaryLabel: "选岗位与任务",
      primaryAction: "compose",
      secondaryLabel: "再找一批岗位",
      secondaryAction: "discover",
    };
  } else {
    model = {
      state: "prepare",
      kicker: "READY TO RUN",
      title: `已选 ${selectedJobs.length} 个岗位、${state.workflowTaskIds.length} 个任务`,
      detail: "Agent 只执行本次勾选的内容，每份产物都保留岗位、Source 和 Trace 关系。",
      primaryLabel: "✦ 发送到当前 Session",
      primaryAction: "run",
      secondaryLabel: "调整任务",
      secondaryAction: "compose",
    };
  }

  elements.dashboardProjectBootstrap.hidden = true;
  elements.dashboardProjectBootstrap.dataset.state = model.state;
  elements.dashboardFocusKicker.textContent = model.kicker;
  elements.dashboardProjectBootstrapTitle.textContent = model.title;
  elements.dashboardProjectBootstrapDetail.textContent = model.detail;
  elements.dashboardInitializeProject.textContent = model.primaryLabel;
  elements.dashboardInitializeProject.dataset.dashboardAction = model.primaryAction;
  elements.dashboardInitializeProject.dataset.jobId = model.jobId || "";
  elements.dashboardInitializeProject.disabled =
    Boolean(context.busy) || (model.primaryAction === "initialize" && projectContext.snapshotUnreadable);
  elements.dashboardFocusSecondary.textContent = model.secondaryLabel;
  elements.dashboardFocusSecondary.dataset.dashboardAction = model.secondaryAction;
  elements.dashboardFocusSecondary.disabled = Boolean(context.busy);
}

async function triageJob(jobId, status) {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job || job.status !== "inbox" || !["saved", "archived"].includes(status)) return;
  const result = updateApplicationProgress(
    job,
    {
      status,
      note: status === "saved" ? "从待筛选标记为感兴趣" : "从待筛选忽略并归档",
    },
    {
      eventId: uid("application"),
      source: "user",
      now: new Date().toISOString(),
    },
  );
  if (!result.changed) return;
  Object.assign(job, result.job);
  if (status === "archived") {
    state.workflowJobIds = state.workflowJobIds.filter((id) => id !== job.id);
  }
  if (
    job.id === state.selectedJobId &&
    !applicationStatusMatchesFilter(job.status, state.statusFilter)
  ) {
    state.selectedJobId = jobsForCurrentFilter()[0]?.id || "";
  }
  persist();
  renderAll();
  await writeProjectSnapshot();
  renderMaterials();
  notify(
    status === "saved"
      ? `已将 ${job.company} 标记为感兴趣；现在可选入求职任务`
      : `已忽略 ${job.company}；原始 JD 仍保留在已结束中`,
  );
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

function formatDuration(startValue, endValue) {
  const start = new Date(startValue || "").getTime();
  const end = new Date(endValue || "").getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
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
    discovery: [
      {
        label: "继续补全 JD",
        prompt: "继续核验这次找到的岗位，把列表信息尽量补成完整 JD，并更新原记录。",
      },
      {
        label: "调整条件再找",
        prompt: "根据这次结果和当前候选人证据，建议一个更精准的搜索条件；确认后再继续找岗位。",
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
      {
        label: "记录投递进度",
        prompt:
          "根据我接下来提供的真实招聘进展，更新这个岗位的阶段、备注和下一步；如果信息不完整，先只问最必要的一项。",
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
    "resume-point": [
      {
        label: "改进这条",
        prompt:
          "只审阅这条简历要点：核验 Source，指出缺少的范围、行动或结果，在不编造事实的前提下改写，并把完整简历和逐条证据写回面板。",
      },
      {
        label: "练习追问",
        prompt:
          "围绕这条简历要点，从已推荐问题中选择最能验证真实贡献的一题开始模拟面试。先只提问，等我回答后再反馈。",
      },
    ],
    "project-bootstrap": [
      {
        label: "继续补全资料",
        prompt:
          "重新扫描当前项目，只补全缺失的求职资料和待确认项，不覆盖已经存在的真实内容。完成后更新候选人上下文。",
      },
      {
        label: "生成基础简历",
        prompt:
          "检查初始化后的候选人证据；如果足够，按主要目标方向生成第一份有逐条证据的 Base Resume。证据不足时只列出最少待补内容。",
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
  if (
    state.resume.markdown &&
    state.activeView === "resumes"
  ) {
    const resumeJob = activeResumeJob();
    return {
      kind: "resume",
      title: state.resume.title || "当前简历",
      detail:
        state.resume.kind === "base"
          ? `基础简历 · ${state.resume.category || DEFAULT_BASE_RESUME_CATEGORY}`
          : resumeJob
            ? `${resumeJob.company} · ${resumeJob.title}`
            : "岗位定制简历",
      payload: {
        jobId: state.resume.jobId || "",
        resumeVersionId: state.resume.versionId || "",
        resumeKind: state.resume.kind,
        category: state.resume.category,
        baseResumeId: state.resume.baseResumeId || "",
      },
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

function latestTraceForArtifact(kind, id) {
  const workspace = context.cwd || "preview";
  return (
    state.sessionActivity.find(
      (activity) =>
        (activity.workspace || "preview") === workspace &&
        (activity.artifacts || []).some(
          (artifact) => artifact.kind === kind && artifact.id === id,
        ),
    ) || null
  );
}

function inspectSessionTrace(traceId) {
  const workspace = context.cwd || "preview";
  const activity = state.sessionActivity.find(
    (item) => item.id === traceId && (item.workspace || "preview") === workspace,
  );
  if (!activity) return notify("这条生成记录已经不在当前项目的最近 Trace 中", "error");
  focusedSessionTraceId = activity.id;
  state.sessionTraceFilter = "all";
  sessionBridgeContext = clone(activity.target || currentSessionTarget());
  sessionBridgeParentTraceId = activity.id;
  renderSessionBridge();
  elements.sessionBridge.hidden = false;
  requestAnimationFrame(() => {
    elements.sessionActivityList
      .querySelector(`[data-session-trace-card-id="${activity.id}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function renderSessionBridge() {
  const target = sessionBridgeContext;
  const kindLabels = {
    panel: "当前面板",
    jobs: "多个岗位",
    job: "目标岗位",
    discovery: "岗位发现",
    "jd-intake": "JD 收件箱",
    "channel-verification": "渠道验证",
    research: "公司情报",
    resume: "简历版本",
    "resume-point": "简历要点",
    "project-bootstrap": "项目初始化",
    workflow: "组合任务",
    interview: "面试执行",
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
  elements.sendSessionInstruction.disabled =
    Boolean(context.busy) || sessionSubmissionPending;
  renderSessionInstructionPreview();
  renderSessionActivity();
}

function openSessionBridge(
  target = currentSessionTarget(),
  suggestedPrompt = "",
  parentTraceId = "",
) {
  focusedSessionTraceId = "";
  const previousTarget = JSON.stringify([
    sessionBridgeContext.kind,
    sessionBridgeContext.payload,
  ]);
  const nextTarget = JSON.stringify([target.kind, target.payload]);
  sessionBridgeContext = target;
  sessionBridgeParentTraceId = parentTraceId;
  renderSessionBridge();
  elements.sessionBridge.hidden = false;
  if (suggestedPrompt) {
    elements.sessionInstruction.value = suggestedPrompt;
  } else if (previousTarget !== nextTarget || !elements.sessionInstruction.value.trim()) {
    elements.sessionInstruction.value = sessionActionsFor(target)[0]?.prompt || "";
  }
  renderSessionInstructionPreview();
  elements.sessionInstruction.focus();
}

function closeSessionBridge() {
  elements.sessionBridge.hidden = true;
  focusedSessionTraceId = "";
}

function buildSessionBridgePrompt(instruction, target = sessionBridgeContext) {
  const payload = JSON.stringify(target.payload);
  const specialist = {
    resume:
      "这是简历任务；同时加载 job-hunt-hq:resume-writing 与 job-hunt-hq:resume-design skills，用重点简报、Source 证据、视觉层级、ATS 与 A4 质量门槛控制结果。",
    research:
      "这是岗位或公司情报任务；同时加载 job-hunt-hq:job-intelligence skill，保持官方事实、主观评价、reported 与 predicted 信息分离。",
    question:
      "这是面试训练任务；同时加载 job-hunt-hq:interview-coach skill，使用真实证据并一次只推进一个练习目标。",
    gap:
      "这是补强任务；同时加载 job-hunt-hq:interview-coach skill，先区分资料、证据和真实技能缺口。",
    debrief:
      "这是真实面试复盘；同时加载 job-hunt-hq:interview-coach skill，只使用我提供的面试事实。",
  }[target.kind];
  return [
    "请使用 job-hunt-hq:job-hunt-workflow skill 和 panel-app:job-hunt-hq 工具，继续处理我正在面板中查看的对象。",
    specialist || "只加载当前指令实际需要的专用 Skill，不要启动未请求的下游模块。",
    "先调用 get_job_search_context，读取当前项目中适用的 CODESHELL.md，并通过下面的不透明 ID 定位对象。",
    `对象类型：${target.kind}；对象标题：${target.title}；对象标识：${payload}`,
    `我的指令：${instruction}`,
    "只执行这条指令直接要求的任务，不自动扩展成固定全流程。需要结构化更新时用对应 Panel 工具写回；如果缺少真实事实，先在当前 Session 中向我询问，不要编造。",
  ].join("\n");
}

function renderSessionInstructionPreview() {
  const instruction = elements.sessionInstruction.value;
  elements.sessionInstructionCount.textContent = `${instruction.length} / 2000`;
  elements.sessionPromptPreview.textContent = instruction.trim()
    ? buildSessionBridgePrompt(instruction.trim())
    : "填写上面的指令后，这里会显示完整上下文。";
}

function renderSessionActivity() {
  const workspace = context.cwd || "preview";
  const workspaceActivities = (state.sessionActivity || []).filter(
    (item) => (item.workspace || "preview") === workspace,
  );
  const finalizedActivities = workspaceActivities.filter((item) =>
    ["completed", "partial", "failed"].includes(item.status),
  );
  const successfulActivities = finalizedActivities.filter((item) => item.status === "completed");
  const attentionActivities = finalizedActivities.filter((item) =>
    ["partial", "failed"].includes(item.status),
  );
  const durations = finalizedActivities
    .map((item) => {
      const start = new Date(item.startedAt || item.createdAt || "").getTime();
      const end = new Date(item.completedAt || item.updatedAt || "").getTime();
      return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
    })
    .filter((value) => value !== null);
  const averageDuration = durations.length
    ? durations.reduce((total, value) => total + value, 0) / durations.length
    : null;
  elements.sessionTraceRunCount.textContent = String(workspaceActivities.length);
  elements.sessionTraceSuccessRate.textContent = finalizedActivities.length
    ? `${Math.round((successfulActivities.length / finalizedActivities.length) * 100)}%`
    : "--";
  elements.sessionTraceAverageDuration.textContent =
    averageDuration === null
      ? "--"
      : formatDuration("1970-01-01T00:00:00.000Z", new Date(averageDuration).toISOString());
  elements.sessionTraceAttentionCount.textContent = String(attentionActivities.length);
  elements.sessionTraceAttentionCount.classList.toggle("has-attention", attentionActivities.length > 0);
  const matchesFilter = (item) => {
    if (state.sessionTraceFilter === "all") return true;
    if (state.sessionTraceFilter === "running") {
      return ["submitted", "running"].includes(item.status);
    }
    return item.status === state.sessionTraceFilter;
  };
  const filteredActivities = workspaceActivities.filter(matchesFilter);
  const focusedActivity = filteredActivities.find((item) => item.id === focusedSessionTraceId);
  const activities = focusedActivity
    ? [focusedActivity, ...filteredActivities.filter((item) => item.id !== focusedActivity.id)].slice(
        0,
        8,
      )
    : filteredActivities.slice(0, 8);
  const runningCount = workspaceActivities.filter((item) =>
    ["submitted", "running"].includes(item.status),
  ).length;
  elements.sessionActivityCount.textContent =
    state.sessionTraceFilter === "all"
      ? `${workspaceActivities.length} 条`
      : `${filteredActivities.length} / ${workspaceActivities.length} 条`;
  elements.topTraceCount.textContent = runningCount ? `${runningCount} RUN` : String(workspaceActivities.length);
  elements.topTraceCount.classList.toggle("running", runningCount > 0);
  elements.sessionTraceFilters.querySelectorAll("[data-session-trace-filter]").forEach((button) => {
    const active = button.dataset.sessionTraceFilter === state.sessionTraceFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  elements.sessionActivityList.replaceChildren();
  if (!activities.length) {
    elements.sessionActivityList.append(
      makeTextElement(
        "div",
        "session-activity-empty",
        workspaceActivities.length
          ? "当前筛选下没有执行记录。"
          : "还没有发送记录。发送后，你写的原话和执行状态会保留在这里。",
      ),
    );
    return;
  }
  const statusLabels = {
    submitted: "已提交",
    running: "执行中",
    completed: "已结束",
    partial: "部分完成",
    failed: "执行失败",
  };
  for (const activity of activities) {
    const card = document.createElement("article");
    card.className = "session-activity-card";
    card.dataset.sessionTraceCardId = activity.id;
    card.classList.toggle("focused", activity.id === focusedSessionTraceId);
    const header = document.createElement("header");
    const status = makeTextElement(
      "span",
      "session-activity-status",
      statusLabels[activity.status] || "已提交",
    );
    status.dataset.status = activity.status || "submitted";
    header.append(
      makeTextElement("strong", "", activity.target?.title || "当前求职面板"),
      status,
    );
    const instruction = makeTextElement(
      "p",
      "",
      activity.instruction || "未保存指令内容",
    );
    const input = document.createElement("details");
    input.className = "session-trace-input";
    input.append(makeTextElement("summary", "", "查看实际输入"));
    input.append(
      makeTextElement(
        "pre",
        "",
        activity.requestPrompt || activity.instruction || "这条旧记录没有保留完整输入。",
      ),
    );
    const timeline = document.createElement("details");
    timeline.className = "session-trace-timeline";
    timeline.append(
      makeTextElement(
        "summary",
        "",
        `执行步骤 ${(activity.events || []).length}`,
      ),
    );
    const eventList = document.createElement("ol");
    for (const event of activity.events || []) {
      const item = document.createElement("li");
      item.dataset.kind = event.kind;
      item.append(
        makeTextElement("i", "", ""),
        makeTextElement("strong", "", event.label),
        makeTextElement("span", "", formatDate(event.at)),
      );
      if (event.detail) item.append(makeTextElement("p", "", event.detail));
      eventList.append(item);
    }
    timeline.append(eventList);
    const artifacts = document.createElement("div");
    artifacts.className = "session-trace-artifacts";
    for (const artifact of activity.artifacts || []) {
      const artifactButton = makeTextElement(
        "button",
        "session-trace-artifact",
        `${artifact.kind} · ${artifact.label}`,
      );
      artifactButton.type = "button";
      artifactButton.dataset.traceArtifactKind = artifact.kind;
      artifactButton.dataset.traceArtifactId = artifact.id;
      artifacts.append(artifactButton);
    }
    const outcome = document.createElement("section");
    outcome.className = "session-trace-outcome";
    outcome.dataset.status = activity.outcome?.status || activity.status || "submitted";
    if (activity.outcome) {
      outcome.append(
        makeTextElement("strong", "", "OUTPUT / 结果摘要"),
        makeTextElement(
          "p",
          "",
          activity.outcome.summary ||
            (activity.status === "failed" ? "执行失败，查看错误与时间线。" : "本次运行已结束。"),
        ),
      );
      if (activity.outcome.error) {
        outcome.append(makeTextElement("pre", "session-trace-error", activity.outcome.error));
      }
      if (activity.outcome.outputRefs?.length) {
        const refs = document.createElement("div");
        refs.className = "session-trace-output-refs";
        for (const ref of activity.outcome.outputRefs) {
          refs.append(makeTextElement("code", "", ref));
        }
        outcome.append(refs);
      }
    }
    const footer = document.createElement("footer");
    const time = makeTextElement(
      "span",
      "",
      formatDate(activity.updatedAt || activity.createdAt),
    );
    const continueButton = makeTextElement("button", "", "基于这条继续 ↗");
    continueButton.type = "button";
    continueButton.dataset.sessionActivityId = activity.id;
    const rerunButton = makeTextElement("button", "session-trace-rerun", "重新执行");
    rerunButton.type = "button";
    rerunButton.dataset.rerunSessionActivityId = activity.id;
    const traceActions = document.createElement("div");
    traceActions.className = "session-trace-actions";
    traceActions.append(rerunButton, continueButton);
    const feedback = document.createElement("div");
    feedback.className = "session-trace-feedback";
    feedback.append(makeTextElement("span", "", "结果评价"));
    for (const [value, label] of Object.entries(TRACE_FEEDBACK_LABELS)) {
      const button = makeTextElement("button", "", label);
      button.type = "button";
      button.dataset.traceFeedbackId = activity.id;
      button.dataset.traceFeedbackValue = value;
      button.classList.toggle("active", activity.feedback === value);
      button.setAttribute("aria-pressed", String(activity.feedback === value));
      feedback.append(button);
    }
    const traceLabel = makeTextElement("span", "session-trace-id", `TRACE ${activity.id}`);
    const duration = formatDuration(
      activity.startedAt || activity.createdAt,
      activity.completedAt || activity.updatedAt,
    );
    const traceMeta = document.createElement("div");
    traceMeta.className = "session-trace-meta";
    traceMeta.append(time, traceLabel);
    if (activity.parentTraceId) {
      traceMeta.append(
        makeTextElement("span", "session-trace-parent", `↳ ${activity.parentTraceId}`),
      );
    }
    if (duration) traceMeta.append(makeTextElement("span", "session-trace-duration", duration));
    footer.append(traceMeta, traceActions);
    card.append(header, instruction, input);
    if (activity.outcome) card.append(outcome);
    if (artifacts.childElementCount) card.append(artifacts);
    if (eventList.childElementCount) card.append(timeline);
    card.append(feedback);
    card.append(footer);
    elements.sessionActivityList.append(card);
  }
}

function recordSessionSubmission(
  instruction,
  target = sessionBridgeContext,
  parentTraceId = sessionBridgeParentTraceId,
) {
  const now = new Date().toISOString();
  const activity = {
    id: uid("session"),
    target: clone(target),
    instruction,
    requestPrompt: "",
    feedback: "",
    parentTraceId,
    workspace: context.cwd || "preview",
    status: "submitted",
    outcome: null,
    artifacts: [],
    events: [
      {
        id: uid("event"),
        kind: "submitted",
        label: "Panel 已提交任务",
        detail: [target?.title || "当前求职面板", parentTraceId ? `父 Trace：${parentTraceId}` : ""]
          .filter(Boolean)
          .join(" · "),
        at: now,
      },
    ],
    createdAt: now,
    startedAt: "",
    completedAt: "",
    updatedAt: now,
  };
  state.sessionActivity = [activity, ...(state.sessionActivity || [])].slice(0, 24);
  sessionBridgeParentTraceId = "";
  persist();
  renderSessionActivity();
  return activity.id;
}

function recordTraceArtifact(kind, id, label) {
  const traceId = activeTrace()?.id || "";
  const activity = state.sessionActivity.find((item) => item.id === traceId);
  if (!activity || !id) return;
  const artifact = {
    kind: String(kind || "artifact").slice(0, 40),
    id: String(id).slice(0, 120),
    label: String(label || id).slice(0, 160),
  };
  attachTraceArtifact(activity, artifact, {
    id: uid("event"),
    at: new Date().toISOString(),
  });
}

function appendTraceEvent(activity, kind, label, detail = "") {
  return appendTraceEventModel(activity, {
    id: uid("event"),
    kind,
    label,
    detail,
    at: new Date().toISOString(),
  });
}

function recordActiveTraceEvent(kind, label, detail = "") {
  const activity = activeTrace();
  if (!activity) return;
  activeSessionTraceId = activity.id;
  const now = new Date().toISOString();
  if (kind === "failed") {
    finalizeTrace(activity, {
      status: "failed",
      summary: label || "Panel 工具调用失败",
      error: detail,
      label,
      eventId: uid("event"),
      at: now,
    });
  } else {
    appendTraceEvent(activity, kind, label, detail);
  }
  if (["running", "stage", "source", "warning"].includes(kind) && activity.status === "submitted") {
    activity.status = "running";
    activity.startedAt = activity.startedAt || now;
  }
  activity.updatedAt = now;
  persist();
  renderSessionActivity();
}

function updateSessionSubmission(id, status, label = "", detail = "") {
  const activity = state.sessionActivity.find((item) => item.id === id);
  if (!activity) return;
  const now = new Date().toISOString();
  if (["completed", "partial", "failed"].includes(status)) {
    finalizeTrace(activity, {
      status,
      summary: detail || label,
      error: status === "failed" ? detail : "",
      outputRefs: (activity.artifacts || []).map((item) => `${item.kind}:${item.id}`),
      label,
      eventId: uid("event"),
      at: now,
    });
  } else {
    activity.status = status;
    if (status === "running") activity.startedAt = activity.startedAt || now;
    if (label) appendTraceEvent(activity, status, label, detail);
    activity.updatedAt = now;
  }
  persist();
  renderSessionActivity();
}

function openTraceArtifact(kind, id) {
  if (kind === "resume") {
    if (id === resumeRecordId(state.resume)) {
      state.activeView = "resumes";
      closeSessionBridge();
      persist();
      renderAll();
    } else {
      closeSessionBridge();
      activateResumeVersion(id);
    }
    return;
  }
  if (kind === "question-set") {
    if (!state.interviewSets.some((item) => item.id === id)) return;
    state.selectedInterviewSetId = id;
    state.activeView = "interviews";
  } else if (kind === "job") {
    if (!state.jobs.some((item) => item.id === id)) return;
    state.selectedJobId = id;
    state.activeView = "dashboard";
  } else if (kind === "research") {
    const report = state.jobResearch.find((item) => item.id === id);
    if (!report) return;
    state.selectedJobId = report.jobId;
    state.activeView = "research";
  } else if (kind === "preparation-plan") {
    const plan = state.preparationPlans.find((item) => item.id === id);
    if (!plan) return;
    if (plan.jobId) state.selectedJobId = plan.jobId;
    state.activeView = "interviews";
  } else if (kind === "interview-debrief") {
    const debrief = state.interviewDebriefs.find((item) => item.id === id);
    if (!debrief) return;
    if (debrief.jobId) state.selectedJobId = debrief.jobId;
    state.activeView = "interviews";
  } else if (kind === "candidate-context") {
    state.activeView = "materials";
  } else if (kind === "jd-intake") {
    if (!state.jdIntakeItems.some((item) => item.id === id)) return;
    state.activeView = "materials";
  } else if (kind === "workflow") {
    state.activeView = "dashboard";
  } else {
    return;
  }
  closeSessionBridge();
  persist();
  renderAll();
}

function activeTrace() {
  const workspace = context.cwd || "preview";
  return (
    state.sessionActivity.find(
      (item) => item.id === activeSessionTraceId && (item.workspace || "preview") === workspace,
    ) ||
    state.sessionActivity.find(
      (item) =>
        (item.workspace || "preview") === workspace &&
        ["submitted", "running"].includes(item.status),
    ) ||
    null
  );
}

function activateTraceFromToolArgs(args) {
  const traceId = String(args?.trace_id || "").trim().slice(0, 100);
  if (!traceId) return activeTrace();
  const workspace = context.cwd || "preview";
  const activity = state.sessionActivity.find(
    (item) => item.id === traceId && (item.workspace || "preview") === workspace,
  );
  if (!activity) {
    throw new Error("trace_id 不存在或不属于当前项目；请重新读取 Panel 上下文");
  }
  activeSessionTraceId = activity.id;
  return activity;
}

function syncActiveTraceLifecycle(wasBusy, isBusy) {
  const activity = activeTrace();
  if (!activity) return;
  activeSessionTraceId = activity.id;
  const changed = transitionTraceForBusy(activity, wasBusy, isBusy, {
    id: uid("event"),
    at: new Date().toISOString(),
  });
  if (!changed) return;
  persist();
  renderSessionActivity();
  if (wasBusy && !isBusy) activeSessionTraceId = "";
}

function persist({ quiet = true } = {}) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await hostCall("storage.set", {
        key: STORAGE_KEY,
        value: compactPanelLocalState(state),
      });
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
    selectedBaseResumeId: state.selectedBaseResumeId,
    discoveryPreferences: clone(state.discoveryPreferences),
    channelVerifications: clone(state.channelVerifications),
    customProviders: clone(state.customProviders),
    jdIntakeItems: clone(state.jdIntakeItems),
    jobLeads: clone(state.jobLeads),
    discoveryRunReceipts: clone(state.discoveryRunReceipts),
    discoveryReceiptCutoff: state.discoveryReceiptCutoff,
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

function hasLegacyProjectData(value) {
  if (!value || typeof value !== "object" || value.localStateVersion === 2) return false;
  return Boolean(
    value.resume?.markdown ||
      value.profile?.name ||
      [
        "jobs",
        "repos",
        "experiences",
        "jobResearch",
        "versions",
        "interviewSets",
        "preparationPlans",
        "interviewDebriefs",
        "channelVerifications",
        "customProviders",
        "jdIntakeItems",
        "jobLeads",
        "discoveryRunReceipts",
      ].some((field) => Array.isArray(value[field]) && value[field].length),
  );
}

async function writeProjectSnapshotNow() {
  if (projectContext.snapshotUnreadable) {
    projectContext.snapshotDirty = true;
    return false;
  }
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
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
      projectContext.snapshotDirty = false;
      projectContext.snapshotError = "";
      projectContext.snapshotUnreadable = false;
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  projectContext.snapshotDirty = true;
  projectContext.snapshotError =
    lastError instanceof Error ? lastError.message.slice(0, 300) : "项目快照写入失败";
  return false;
}

function writeProjectSnapshot() {
  clearTimeout(projectSnapshotTimer);
  projectSnapshotTimer = null;
  projectContext.snapshotDirty = true;
  projectContext.snapshotError = "";
  const operation = projectSnapshotSaveQueue
    .catch(() => false)
    .then(() => writeProjectSnapshotNow());
  projectSnapshotSaveQueue = operation;
  return operation;
}

function scheduleProjectSnapshotSave(delay = 500) {
  clearTimeout(projectSnapshotTimer);
  projectContext.snapshotDirty = true;
  projectContext.snapshotError = "";
  elements.projectSnapshotState.textContent = "等待保存修改";
  elements.projectSnapshotState.classList.add("error");
  elements.saveProjectSnapshot.hidden = false;
  projectSnapshotTimer = setTimeout(() => {
    void writeProjectSnapshot().then(() => renderMaterials());
  }, delay);
}

function requireProjectSnapshot(saved) {
  if (!saved) {
    renderMaterials();
    throw new Error("结构化结果已生成，但未能写入当前项目；请在材料库重试保存");
  }
}

async function importScheduledDiscoveryRuns() {
  if (
    scheduledReceiptImportPending ||
    !context.cwd ||
    projectContext.snapshotUnreadable
  ) {
    return;
  }
  scheduledReceiptImportPending = true;
  let importedFiles = 0;
  let formalCount = 0;
  let leadCount = 0;
  try {
    let listing;
    try {
      listing = await hostCall("workspace.list", { path: "career-data/discovery/runs" });
    } catch {
      return;
    }
    const knownPaths = new Set(state.discoveryRunReceipts.map((receipt) => receipt.path));
    const paths = (listing?.entries || [])
      .filter(
        (entry) =>
          entry.kind === "file" &&
          String(entry.name || "").toLowerCase().endsWith(".json") &&
          !knownPaths.has(entry.path),
      )
      .map((entry) => entry.path)
      .sort()
      .slice(-20);

    for (const path of paths) {
      try {
        const file = await hostCall("workspace.readText", { path });
        const parsed = JSON.parse(file.content);
        if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.jobs)) {
          throw new Error("scheduled discovery receipt schema is invalid");
        }
        const generatedAt = Date.parse(String(parsed.generatedAt || ""));
        const cutoff = Date.parse(String(state.discoveryReceiptCutoff || ""));
        if (Number.isFinite(generatedAt) && Number.isFinite(cutoff) && generatedAt <= cutoff) {
          state.discoveryRunReceipts.push({
            id: cleanText(parsed.runId, 160) || path,
            path,
            importedAt: new Date().toISOString(),
            formalCount: 0,
            leadCount: 0,
          });
          continue;
        }
        const incoming = parsed.jobs
          .slice(0, 40)
          .map((job, index) => normalizeIncomingOpportunity(job, index, "receipt.jobs"));
        if (!incoming.length) {
          state.discoveryRunReceipts.push({
            id: cleanText(parsed.runId, 160) || path,
            path,
            importedAt: new Date().toISOString(),
            formalCount: 0,
            leadCount: 0,
          });
          importedFiles += 1;
          continue;
        }
        const routed = upsertJobDiscovery(state.jobs, state.jobLeads, incoming, {
          dedupeKey: jobDedupeKey,
          metadataKey: jobMetadataKey,
        });
        const formalIncoming = incoming.filter((job) => assessJobOpportunity(job).isFormal);
        for (const sourceJob of formalIncoming) {
          const job = routed.jobs.find(
            (item) =>
              jobDedupeKey(item) === jobDedupeKey(sourceJob) ||
              jobMetadataKey(item) === jobMetadataKey(sourceJob),
          );
          if (!job) continue;
          job.jdPath = formalJdPath(job);
          await upsertWorkspaceText(job.jdPath, `${formalJdMarkdown(job)}\n`);
        }
        state.jobs = routed.jobs.slice(0, 80);
        state.jobLeads = routed.leads.slice(0, 160);
        const receiptFormal = routed.insertedJobs.length;
        const receiptLeads = routed.insertedLeads.length;
        formalCount += receiptFormal;
        leadCount += receiptLeads;
        state.discoveryRunReceipts.push({
          id: cleanText(parsed.runId, 160) || path,
          path,
          importedAt: new Date().toISOString(),
          formalCount: receiptFormal,
          leadCount: receiptLeads,
        });
        state.discoveryRunReceipts = state.discoveryRunReceipts.slice(-100);
        importedFiles += 1;
      } catch (error) {
        state.discoveryRunReceipts.push({
          id: path,
          path,
          importedAt: new Date().toISOString(),
          formalCount: 0,
          leadCount: 0,
          error: error instanceof Error ? error.message.slice(0, 300) : "收据无法读取",
        });
      }
    }
    if (!paths.length) return;
    persist();
    renderAll();
    await writeProjectSnapshot();
    if (importedFiles) {
      notify(
        `已导入 ${importedFiles} 次定时抓取：${formalCount} 个完整 JD，${leadCount} 条待补全线索`,
        "success",
      );
    }
  } finally {
    scheduledReceiptImportPending = false;
  }
}

async function syncProjectContext({
  quiet = true,
  localStateSource = state,
  allowLegacyMigration = false,
} = {}) {
  const localState = compactPanelLocalState(localStateSource);
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
      if (parsed?.schemaVersion !== 1 && parsed?.schemaVersion !== 2) {
        throw new Error("项目快照 schemaVersion 不受支持");
      }
      const migrated = mergeState({ ...parsed, ...localState });
      if (!Array.isArray(parsed.jobResearch)) migrated.jobResearch = [];
      if (!Array.isArray(parsed.workflowRuns)) migrated.workflowRuns = [];
      if (!Array.isArray(parsed.preparationPlans)) migrated.preparationPlans = [];
      if (!Array.isArray(parsed.interviewDebriefs)) migrated.interviewDebriefs = [];
      state = migrated;
      projectContext.hasSnapshot = true;
      projectContext.lastSyncedAt = parsed.updatedAt || "";
      projectContext.snapshotRevision = snapshot.revision || "";
      projectContext.snapshotDirty = false;
      projectContext.snapshotError = "";
      projectContext.snapshotUnreadable = false;
      if (allowLegacyMigration) persist();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "");
      const snapshotMissing = /ENOENT|no such file|file not found/i.test(message);
      projectContext.hasSnapshot = false;
      projectContext.snapshotUnreadable = !snapshotMissing;
      projectContext.snapshotError = snapshotMissing
        ? ""
        : `无法读取 ${PROJECT_STATE_PATH}：${message.slice(0, 240)}`;
      if (
        window.codeshellPanel?.call &&
        snapshotMissing &&
        allowLegacyMigration &&
        hasLegacyProjectData(localStateSource)
      ) {
        state = mergeState(localStateSource);
        const migrated = await writeProjectSnapshot();
        if (migrated) persist();
        else projectContext.snapshotDirty = true;
      } else if (window.codeshellPanel?.call && snapshotMissing) {
        state = mergeState({ ...emptyProjectState(), ...localState });
      }
    }
    renderAll();
    void importScheduledDiscoveryRuns();
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
  const eligibleJobs = workflowEligibleJobs();
  const availableIds = new Set(eligibleJobs.map((job) => job.id));
  state.workflowJobIds = state.workflowJobIds.filter((id) => availableIds.has(id));
  elements.workflowJobPicker.replaceChildren();
  if (!eligibleJobs.length) {
    const emptyText = state.jobs.some((job) => job.status === "inbox")
      ? "抓取的岗位还在待筛选；先标记感兴趣，再加入简历、调研或面试任务。"
      : state.jobs.length
        ? "还没有关注中的岗位，也可以先处理通用简历与材料。"
        : "还没有岗位，可先只处理通用简历与材料。";
    elements.workflowJobPicker.append(
      makeTextElement("span", "workflow-picker-empty", emptyText),
    );
  } else {
    for (const job of eligibleJobs) {
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
  const missingJobTasks = workflowMissingJobTasks();
  const taskLabels = state.workflowTaskIds
    .map((id) => WORKFLOW_TASKS[id]?.label)
    .filter(Boolean);
  elements.workflowTaskPicker
    .querySelectorAll("[data-workflow-task]")
    .forEach((button) => {
      const needsJob = Boolean(WORKFLOW_TASKS[button.dataset.workflowTask]?.requiresJob);
      button.classList.toggle("missing-job-context", needsJob && !jobs.length);
      button.title = needsJob && !jobs.length ? "先选择一个关注岗位" : "";
    });
  if (!eligibleJobs.length) {
    elements.workflowBuilderTitle.textContent = "先筛选岗位，也可以只处理通用材料";
    elements.workflowBuilderDescription.textContent =
      "Base Resume、Commit 深挖题和通用补强不需选岗位；JD 匹配、公司面经和定制题库需要先标记感兴趣。";
  } else if (!jobs.length) {
    elements.workflowBuilderTitle.textContent = "选择本次要准备的关注岗位";
    elements.workflowBuilderDescription.textContent = `当前有 ${eligibleJobs.length} 个关注岗位；选定对象后，再决定做简历、调研、题库还是模拟面试。`;
  } else {
    elements.workflowBuilderTitle.textContent = `为 ${jobs.length} 个岗位组合本次准备任务`;
    elements.workflowBuilderDescription.textContent =
      "只执行这次勾选的任务；不会因为选了岗位就自动生成所有产物。";
  }
  const jobSummary = jobs.length
    ? `${jobs.length} 个岗位`
    : "通用候选人材料（未选岗位）";
  elements.workflowSelectionSummary.textContent = missingJobTasks.length
    ? `还需选岗位：${missingJobTasks.map((id) => WORKFLOW_TASKS[id].label).join("、")}`
    : taskLabels.length
      ? `${jobSummary} · ${taskLabels.join("、")}`
      : `${jobSummary} · 请选择至少一个任务`;
  elements.workflowSelectionSummary.classList.toggle("warning", missingJobTasks.length > 0);
  elements.runCustomWorkflow.disabled =
    Boolean(context.busy) || taskLabels.length === 0 || missingJobTasks.length > 0;
}

function renderCounts() {
  const counts = {
    all: state.jobs.length,
    inbox: state.jobs.filter((job) => job.status === "inbox").length,
    saved: state.jobs.filter((job) => job.status === "saved").length,
    tailoring: state.jobs.filter((job) => job.status === "tailoring").length,
    applied: state.jobs.filter((job) => job.status === "applied").length,
    interviewing: state.jobs.filter((job) =>
      applicationStatusMatchesFilter(job.status, "interview"),
    ).length,
    offer: state.jobs.filter((job) => job.status === "offer").length,
    closed: state.jobs.filter((job) => applicationStatusMatchesFilter(job.status, "closed"))
      .length,
  };
  elements.jobNavCount.textContent = String(state.jobs.length);
  elements.sourceNavCount.textContent = context.cwd ? "1" : "0";
  elements.researchNavCount.textContent = String(state.jobResearch.length);
  elements.resumeNavCount.textContent = String(resumeRecords().length);
  elements.interviewNavCount.textContent = String(
    state.interviewSets.length + state.interviewDebriefs.length,
  );
  elements.allCount.textContent = String(counts.all);
  elements.inboxCount.textContent = String(counts.inbox);
  elements.savedCount.textContent = String(counts.saved);
  elements.tailoringCount.textContent = String(counts.tailoring);
  elements.appliedCount.textContent = String(counts.applied);
  elements.interviewingCount.textContent = String(counts.interviewing);
  elements.offerCount.textContent = String(counts.offer);
  elements.closedCount.textContent = String(counts.closed);
  document.querySelectorAll("[data-status-filter]").forEach((button) => {
    button.classList.toggle("active-soft", button.dataset.statusFilter === state.statusFilter);
  });
  document.querySelectorAll("[data-job-status-shortcut]").forEach((button) => {
    button.classList.toggle("active", button.dataset.jobStatusShortcut === state.statusFilter);
  });
  document.querySelectorAll("[data-job-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.jobFilter === state.jobFilter);
  });
}

function renderStats() {
  const eligibleJobs = workflowEligibleJobs();
  const inboxCount = state.jobs.filter((job) => job.status === "inbox").length;
  const activeApplications = state.jobs.filter((job) =>
    ["applied", "screening", "interviewing", "offer"].includes(job.status),
  );
  const interviewCount = activeApplications.filter((job) =>
    ["screening", "interviewing"].includes(job.status),
  ).length;
  const offerCount = activeApplications.filter((job) => job.status === "offer").length;
  const sourceCount = new Set(
    state.jobs.map((job) => normalizeSourceId(job.sourceId, job.source)),
  ).size;
  elements.statJobs.textContent = String(state.jobs.length).padStart(2, "0");
  elements.statSourceDetail.textContent = sourceCount
    ? `来自 ${sourceCount} 个岗位来源${state.jobLeads.length ? ` · ${state.jobLeads.length} 条线索待补全` : ""}`
    : state.jobLeads.length
      ? `${state.jobLeads.length} 条线索待补全，尚无完整 JD`
      : "岗位池还是空的";
  elements.statMatch.textContent = String(inboxCount).padStart(2, "0");
  elements.statSources.textContent = String(eligibleJobs.length).padStart(2, "0");
  elements.statNext.textContent = String(activeApplications.length).padStart(2, "0");
  elements.statNextDetail.textContent = activeApplications.length
    ? `${interviewCount} 个沟通 / 面试 · ${offerCount} 个 Offer`
    : "尚无投递记录";
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
  const query = jobSearchQuery.trim().toLocaleLowerCase();
  const jobs = state.jobs.filter((job) => {
    if (!applicationStatusMatchesFilter(job.status, state.statusFilter)) return false;
    if (state.jobFilter === "90" && calculateMatch(job) < 90) return false;
    if (
      state.jobSourceFilter !== "all" &&
      normalizeSourceId(job.sourceId, job.source) !== state.jobSourceFilter
    ) {
      return false;
    }
    if (!query) return true;
    return [job.company, job.title, job.location, job.salary, job.source, job.description]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query);
  });
  const time = (job, fields) => {
    for (const field of fields) {
      const value = Date.parse(String(job[field] || ""));
      if (Number.isFinite(value)) return value;
    }
    return 0;
  };
  return jobs.sort((left, right) => {
    if (jobSort === "match") return calculateMatch(right) - calculateMatch(left);
    if (jobSort === "company") {
      return String(left.company || "").localeCompare(String(right.company || ""), "zh-CN");
    }
    if (jobSort === "published") {
      return (
        time(right, ["publishedAt", "fetchedAt", "createdAt"]) -
        time(left, ["publishedAt", "fetchedAt", "createdAt"])
      );
    }
    return (
      time(right, ["createdAt", "fetchedAt", "publishedAt"]) -
      time(left, ["createdAt", "fetchedAt", "publishedAt"])
    );
  });
}

function alignSelectedJobToCurrentFilter() {
  const visibleJobs = jobsForCurrentFilter();
  if (!visibleJobs.some((job) => job.id === state.selectedJobId)) {
    state.selectedJobId = visibleJobs[0]?.id || "";
  }
}

function makeTextElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function renderJobLeads() {
  if (!elements.jobLeadsPanel || !elements.jobLeadList) return;
  const leads = [...state.jobLeads].sort((left, right) =>
    String(right.updatedAt || right.fetchedAt || right.createdAt || "").localeCompare(
      String(left.updatedAt || left.fetchedAt || left.createdAt || ""),
    ),
  );
  elements.jobLeadsPanel.hidden = leads.length === 0;
  elements.jobLeadCount.textContent = String(leads.length);
  elements.jobLeadList.replaceChildren();
  for (const lead of leads) {
    const row = document.createElement("article");
    row.className = "job-lead-row";
    const copy = document.createElement("div");
    copy.className = "job-lead-copy";
    copy.append(
      makeTextElement("strong", "", `${lead.company || "公司待确认"} · ${lead.title || "岗位待确认"}`),
      makeTextElement(
        "small",
        "",
        `${lead.source || "来源待确认"} · ${cleanTextList(lead.missingFields, 4, 80).join("、") || "等待补全详情页"}`,
      ),
    );
    const actions = document.createElement("div");
    actions.className = "job-lead-actions";
    const complete = makeTextElement("button", "button button-primary button-compact", "补全 JD");
    complete.type = "button";
    complete.dataset.completeJobLeadId = lead.id;
    complete.disabled = Boolean(context.busy);
    const remove = makeTextElement("button", "button button-danger-quiet button-compact", "删除");
    remove.type = "button";
    remove.dataset.removeJobLeadId = lead.id;
    remove.disabled = Boolean(context.busy);
    actions.append(complete, remove);
    row.append(copy, actions);
    elements.jobLeadList.append(row);
  }
}

function renderJobs() {
  const previousScrollTop = elements.jobList.scrollTop;
  renderSourceFilter();
  const jobs = jobsForCurrentFilter();
  const panelCopy = {
    inbox: ["待筛选收件箱", `${jobs.length} 个岗位等待判断，不会自动准备`],
    active: ["关注岗位", `${jobs.length} 个岗位可以加入本次准备任务`],
    saved: ["感兴趣", `${jobs.length} 个岗位尚未开始准备`],
    tailoring: ["准备中", `${jobs.length} 个岗位正在完善材料`],
    applied: ["已投递", `${jobs.length} 个岗位等待跟进`],
    interview: ["沟通 / 面试", `${jobs.length} 个岗位正在推进`],
    offer: ["Offer", `${jobs.length} 个待决策机会`],
    closed: ["已结束", `${jobs.length} 个岗位已归档`],
    all: ["全部岗位", `${jobs.length} 个符合当前筛选条件`],
  }[state.statusFilter] || ["岗位收件箱", `${jobs.length} 个岗位`];
  elements.opportunitiesTitle.textContent = panelCopy[0];
  elements.opportunitiesSummary.textContent = state.jobLeads.length
    ? `${panelCopy[1]} · ${state.jobLeads.length} 条线索待补全`
    : panelCopy[1];
  elements.jobList.replaceChildren();
  for (const job of jobs) {
    const shell = document.createElement("article");
    shell.className = "job-card-shell";
    const card = document.createElement("button");
    card.type = "button";
    card.className = `job-card${job.id === state.selectedJobId ? " active" : ""}`;
    card.dataset.jobId = job.id;
    card.setAttribute("aria-pressed", String(job.id === state.selectedJobId));
    card.setAttribute("aria-label", `${job.company} ${job.title}`);

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
    const recency = resolveJobRecency(job);
    const recencyBadge = makeTextElement("span", "job-recency-badge", recency.label);
    recencyBadge.dataset.recency = recency.state;
    const status = makeTextElement(
      "span",
      "status-badge",
      APPLICATION_STAGE_LABELS[job.status] || "待筛选",
    );
    status.dataset.status = job.status;
    badges.append(completeness, recencyBadge, status);
    bottom.append(badges);
    card.append(top, title, meta, bottom);
    const application = normalizeJobApplication(job).application;
    if (application.nextAction) {
      card.append(
        makeTextElement(
          "div",
          "job-next-action",
          `下一步 · ${application.nextAction}${application.nextActionAt ? ` · ${application.nextActionAt.slice(0, 10)}` : ""}`,
        ),
      );
    }
    shell.append(card);
    elements.jobList.append(shell);
  }
  elements.jobList.scrollTop = previousScrollTop;
  elements.emptyAddJob.hidden = jobs.length > 0;
  elements.emptyAddJob.textContent =
    state.statusFilter === "inbox"
      ? "待筛选已清空，去找更多岗位"
      : state.statusFilter === "active"
        ? "还没有关注岗位，先去待筛选看看"
        : "添加第一个职位";
  renderJobLeads();
}

function candidateInitials() {
  const name = String(state.profile.name || "").trim();
  return name ? [...name].slice(-2).join("") : "照片";
}

function makeResumePhotoSlot() {
  const figure = document.createElement("figure");
  figure.className = "resume-photo-slot";
  if (isSupportedResumePhoto(state.profile.photoDataUrl)) {
    const image = document.createElement("img");
    image.src = state.profile.photoDataUrl;
    image.alt = `${state.profile.name || "候选人"}照片`;
    figure.append(image);
  } else {
    figure.classList.add("placeholder");
    figure.append(
      makeTextElement("strong", "", candidateInitials()),
      makeTextElement("span", "", "照片位 · 3:4"),
    );
  }
  return figure;
}

function makeResumeEvidenceBadge(label, className = "") {
  return makeTextElement("span", `resume-point-badge ${className}`.trim(), label);
}

function makeResumeClaimAnnotation(item, claimIndex) {
  const evidence = item.evidence;
  const details = document.createElement("details");
  details.className = `resume-point-proof strength-${item.strength}`;
  const summary = document.createElement("summary");
  summary.append(
    makeResumeEvidenceBadge(
      evidence?.importance === "core" ? "核心重点" : "辅助信息",
      evidence?.importance === "core" ? "core" : "supporting",
    ),
    makeResumeEvidenceBadge(
      RESUME_STRENGTH_LABELS[item.strength] || "证据待核验",
      item.strength,
    ),
  );
  if (evidence?.sources?.length) {
    summary.append(
      makeTextElement(
        "span",
        "resume-point-source-summary",
        `Source · ${evidence.sources.map((source) => source.label).slice(0, 2).join(" + ")}`,
      ),
    );
  } else {
    summary.append(makeTextElement("span", "resume-point-source-summary missing", "缺少 Source"));
  }
  summary.append(
    makeResumeEvidenceBadge(
      `${evidence?.interviewQuestions?.length || 0} 个面试追问`,
      "questions",
    ),
  );

  const body = document.createElement("div");
  body.className = "resume-point-proof-body";
  const rationale = document.createElement("section");
  rationale.className = "resume-point-rationale";
  rationale.append(
    makeTextElement("strong", "", "为什么是重点"),
    makeTextElement(
      "p",
      "",
      evidence?.whyItMatters || "还没有说明这条内容对目标方向的价值。",
    ),
  );
  body.append(rationale);

  const sourceSection = document.createElement("section");
  sourceSection.className = "resume-point-sources";
  sourceSection.append(makeTextElement("strong", "", "证据与定位"));
  if (evidence?.sources?.length) {
    for (const source of evidence.sources) {
      const sourceCard = document.createElement("article");
      sourceCard.className = "resume-point-source-card";
      const sourceHeader = document.createElement("header");
      sourceHeader.append(
        makeTextElement(
          "span",
          "resume-point-source-kind",
          RESUME_SOURCE_KIND_LABELS[source.kind] || "Source",
        ),
        makeTextElement("strong", "", source.label),
        makeTextElement("code", "", source.locator),
      );
      sourceCard.append(
        sourceHeader,
        makeTextElement(
          "p",
          source.evidence ? "" : "missing",
          source.evidence || "当前只有定位符，还没有说明这份材料具体证明了什么。",
        ),
      );
      sourceSection.append(sourceCard);
    }
  } else {
    sourceSection.append(
      makeTextElement("p", "resume-point-empty", "没有候选人材料可以支持这条表述。"),
    );
  }
  body.append(sourceSection);

  const questionSection = document.createElement("section");
  questionSection.className = "resume-point-questions";
  questionSection.append(makeTextElement("strong", "", "面试官可能追问"));
  if (evidence?.interviewQuestions?.length) {
    const questionList = document.createElement("ol");
    for (const question of evidence.interviewQuestions) {
      const questionItem = document.createElement("li");
      questionItem.append(makeTextElement("span", "", question.question));
      if (question.focus) {
        questionItem.append(makeTextElement("small", "", `验证：${question.focus}`));
      }
      questionList.append(questionItem);
    }
    questionSection.append(questionList);
  } else {
    questionSection.append(
      makeTextElement("p", "resume-point-empty", "还没有为这条内容准备验证性问题。"),
    );
  }
  body.append(questionSection);

  if (evidence?.improvement || item.strength !== "strong") {
    const improvement = document.createElement("section");
    improvement.className = "resume-point-improvement";
    improvement.append(
      makeTextElement("strong", "", "如何改善"),
      makeTextElement(
        "p",
        "",
        evidence?.improvement || "补充可核验的行动细节、范围或结果，再把 Source 的证明内容写清楚。",
      ),
    );
    body.append(improvement);
  }

  const actions = document.createElement("div");
  actions.className = "resume-point-actions";
  for (const [action, label] of [
    ["improve", "让 Agent 改进这条"],
    ["practice", "开始练习追问"],
  ]) {
    const button = makeTextElement("button", "", label);
    button.type = "button";
    button.dataset.resumeClaimIndex = String(claimIndex);
    button.dataset.resumeClaimAction = action;
    actions.append(button);
  }
  body.append(actions);
  details.append(summary, body);
  return details;
}

function appendAnnotatedResumeClaim(container, tagName, text, item, claimIndex) {
  const element = document.createElement(tagName);
  element.className = `resume-claim${item.evidence?.importance === "core" ? " core" : ""}`;
  element.append(makeTextElement("span", "resume-claim-copy", text));
  element.append(makeResumeClaimAnnotation(item, claimIndex));
  container.append(element);
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
        "先填写求职大类并生成 Base Resume；选择岗位后，再从基础版本派生 JD 定制版。",
      ),
    );
    elements.resumePreview.append(inner);
    return;
  }

  elements.resumePreview.append(makeResumePhotoSlot());
  const evidenceCoverage = resumeEvidenceCoverage(markdown, state.resume.claimEvidence);
  const evidenceByClaim = new Map(
    evidenceCoverage.mapped.map((item, index) => [
      normalizeResumeClaim(item.claim).toLocaleLowerCase(),
      { item, index },
    ]),
  );
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
      const text = line.replace(/^[-*]\s/, "");
      const mapped = evidenceByClaim.get(normalizeResumeClaim(text).toLocaleLowerCase());
      if (mapped) appendAnnotatedResumeClaim(list, "li", text, mapped.item, mapped.index);
      else list.append(makeTextElement("li", "", text));
    } else {
      list = null;
      const mapped = evidenceByClaim.get(normalizeResumeClaim(line).toLocaleLowerCase());
      if (mapped) {
        appendAnnotatedResumeClaim(
          elements.resumePreview,
          "div",
          line,
          mapped.item,
          mapped.index,
        );
      } else {
        elements.resumePreview.append(makeTextElement("p", "", line));
      }
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

function renderBaseResumeControls() {
  const bases = baseResumes();
  const selectedBase = selectedBaseResume();
  elements.baseResumeSelect.replaceChildren();
  if (!bases.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "还没有 Base Resume";
    elements.baseResumeSelect.append(option);
  } else {
    for (const base of bases) {
      const option = document.createElement("option");
      option.value = resumeRecordId(base);
      option.textContent = `${base.category} · ${base.title || "基础简历"}`;
      elements.baseResumeSelect.append(option);
    }
    elements.baseResumeSelect.value = resumeRecordId(selectedBase);
  }
  if (document.activeElement !== elements.resumeCategory) {
    elements.resumeCategory.value =
      selectedBase?.category ||
      (state.resume.kind === "base" ? state.resume.category : "") ||
      state.profile.target ||
      state.profile.role ||
      DEFAULT_BASE_RESUME_CATEGORY;
  }
  elements.baseResumeSelect.disabled = !bases.length;
  const style = normalizeResumeStyle(state.resume.style);
  elements.resumeTemplateSelect.value = style.template;
  elements.resumeDensitySelect.value = style.density;
  elements.tailorResume.disabled =
    Boolean(context.busy) ||
    !isWorkflowEligibleStage(selectedJob()?.status) ||
    !selectedBase;
  elements.tailorResume.title =
    selectedJob()?.status === "inbox"
      ? "先将这个岗位标记为感兴趣，再派生定制简历"
      : "从当前 Base Resume 派生岗位版";
  elements.removeResumePhoto.disabled = !isSupportedResumePhoto(state.profile.photoDataUrl);
}

function renderResumeEvidence() {
  const coverage = resumeEvidenceCoverage(state.resume.markdown, state.resume.claimEvidence);
  elements.resumeEvidenceCoverage.textContent = `${coverage.complete} / ${coverage.total}`;
  elements.resumeEvidenceCoverage.classList.toggle(
    "incomplete",
    coverage.total > 0 && coverage.complete < coverage.total,
  );
  elements.resumeEvidenceSummary.textContent = coverage.total
    ? `${coverage.core} 条核心重点 · ${coverage.strong} 条直接证据 · ${coverage.questionsReady} 条可练追问`
    : "每条要点都应说明重点、证据和面试追问";
  elements.resumeEvidenceList.replaceChildren();

  if (!coverage.total) {
    elements.resumeEvidenceList.append(
      makeTextElement(
        "span",
        "resume-evidence-empty",
        state.resume.markdown ? "当前简历没有可映射的 bullet。" : "生成 Base Resume 后会在这里显示证据映射。",
      ),
    );
    return;
  }

  for (const item of coverage.mapped) {
    const row = document.createElement("article");
    row.className = `resume-evidence-item${
      !item.evidence
        ? " missing"
        : item.strength === "strong"
          ? ""
          : " needs-review"
    }`;
    const sources = document.createElement("div");
    sources.className = "resume-evidence-sources";
    if (item.evidence?.sources.length) {
      for (const source of item.evidence.sources) {
        const chip = makeTextElement(
          "span",
          "resume-source-chip",
          `${source.kind.toUpperCase()} · ${source.label}`,
        );
        chip.dataset.kind = source.kind;
        chip.title = `${source.locator}${source.evidence ? `\n${source.evidence}` : ""}`;
        sources.append(chip);
      }
    } else {
      sources.append(makeTextElement("span", "resume-source-chip", "缺少 Source"));
    }
    const claim = document.createElement("div");
    claim.append(
      makeTextElement("p", "", item.claim),
      makeTextElement(
        "small",
        "",
        item.evidence
          ? `${item.evidence.importance === "core" ? "核心重点" : "辅助信息"} · ${RESUME_STRENGTH_LABELS[item.strength]} · ${item.evidence.interviewQuestions.length} 个追问`
          : "缺少逐字匹配的证据记录",
      ),
    );
    row.append(claim, sources);
    elements.resumeEvidenceList.append(row);
  }
}

function renderResume() {
  const selectedJd = selectedJob();
  const resumeJob = activeResumeJob();
  const hasResume = Boolean(state.resume.markdown);
  const style = normalizeResumeStyle(state.resume.style);
  state.resume.style = style;
  elements.resumePreview.dataset.template = style.template;
  elements.resumePreview.dataset.density = style.density;
  elements.resumeEditor.dataset.template = style.template;
  elements.resumeEditor.dataset.density = style.density;
  renderBaseResumeControls();
  elements.resumeKindLabel.textContent = state.resume.kind === "variant" ? "JD VARIANT" : "BASE";
  elements.resumeKindLabel.dataset.kind = state.resume.kind;
  elements.resumeTitle.textContent = hasResume
    ? state.resume.title
    : "先建立方向级基础简历";
  elements.resumeJobLabel.textContent = hasResume
    ? state.resume.kind === "base"
      ? `基础简历 · ${state.resume.category || DEFAULT_BASE_RESUME_CATEGORY}`
      : resumeJob
        ? `${resumeJob.company} / ${resumeJob.title} · 派生自 ${state.resume.category}`
        : `岗位定制版 · 派生自 ${state.resume.category}`
    : "还没有 Base Resume；当前 JD 不会自动触发定制";
  elements.resumeUpdated.textContent = hasResume && state.resume.updatedAt
    ? `更新于 ${formatDate(state.resume.updatedAt)}`
    : "未生成";
  const latestPdfExport = state.resume.pdfExports?.[0];
  elements.resumeExportStatus.textContent = latestPdfExport
    ? `PDF · ${formatDate(latestPdfExport.exportedAt)}`
    : "尚未导出 PDF";
  elements.resumeExportStatus.title = latestPdfExport?.path || "";
  elements.resumeEditor.value = hasResume ? state.resume.markdown : "";
  renderMarkdown(hasResume ? state.resume.markdown : "");
  renderResumeEvidence();
  renderJobDescription(selectedJd);
  const editing = resumeMode === "edit";
  const showingJd = resumeMode === "jd";
  elements.resumePreview.hidden = editing || showingJd;
  elements.resumeEditor.hidden = !editing;
  elements.jdPreview.hidden = !showingJd;
  document.querySelectorAll("[data-resume-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.resumeMode === resumeMode);
  });
  const originTrace = hasResume
    ? latestTraceForArtifact("resume", resumeRecordId(state.resume))
    : null;
  elements.saveResume.disabled = !hasResume;
  elements.printResume.disabled = !hasResume;
  elements.resumeTrace.disabled = !originTrace;
  elements.resumeTrace.dataset.inspectTraceId = originTrace?.id || "";
  elements.resumeTrace.title = originTrace
    ? `查看 ${formatDate(originTrace.updatedAt || originTrace.createdAt)} 的生成记录`
    : "当前版本没有保留可用的生成 Trace";
  elements.generateResume.disabled = Boolean(context.busy);
  elements.continueResumeSession.disabled = !hasResume || Boolean(context.busy);
}

function openResumePointSession(claimIndex, action) {
  const coverage = resumeEvidenceCoverage(state.resume.markdown, state.resume.claimEvidence);
  const item = coverage.mapped[claimIndex];
  if (!item) return notify("这条简历要点已变化，请刷新后重试", "error");
  const evidence = item.evidence;
  const sourceLocators = evidence?.sources?.map((source) => source.locator) || [];
  const practicePrompt = evidence?.interviewQuestions?.length
    ? `围绕这条简历要点，从推荐问题“${evidence.interviewQuestions[0].question}”开始模拟面试。先只提问，等我回答后再反馈和追问。`
    : "围绕这条简历要点生成一个能核验真实贡献的面试问题，然后直接开始模拟面试。先只提问。";
  const improvePrompt = [
    "只审阅并改进这条简历要点。先读取列出的 Source，核验它具体支持了哪些事实；不要编造数据。",
    evidence?.improvement ? `当前建议：${evidence.improvement}` : "检查行动、范围和结果是否足够具体。",
    "需要修改时，保存完整的新简历版本，并同步更新这条要点的重点说明、证据内容和面试追问。",
  ].join("\n");
  openSessionBridge(
    {
      kind: "resume-point",
      title: item.claim.slice(0, 80),
      detail: `${evidence?.importance === "core" ? "核心重点" : "辅助信息"} · ${RESUME_STRENGTH_LABELS[item.strength] || "待核验"}`,
      payload: {
        resumeVersionId: resumeRecordId(state.resume),
        resumeKind: state.resume.kind,
        jobId: state.resume.jobId || "",
        claim: item.claim,
        sourceLocators,
      },
    },
    action === "practice" ? practicePrompt : improvePrompt,
  );
}

function dateInputValue(value) {
  const normalized = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(normalized) ? normalized.slice(0, 10) : "";
}

function renderApplicationTracker(job) {
  elements.applicationStage.replaceChildren(
    ...APPLICATION_STAGE_IDS.map((stage) => {
      const option = document.createElement("option");
      option.value = stage;
      option.textContent = APPLICATION_STAGE_LABELS[stage];
      return option;
    }),
  );
  elements.applicationHistory.replaceChildren();
  if (!job) {
    elements.applicationStage.value = "inbox";
    elements.applicationStage.disabled = true;
    elements.applicationNextAction.value = "";
    elements.applicationNextAction.disabled = true;
    elements.applicationNextActionAt.value = "";
    elements.applicationNextActionAt.disabled = true;
    elements.applicationNote.value = "";
    elements.applicationNote.disabled = true;
    elements.updateApplication.disabled = true;
    elements.applicationStageUpdated.textContent = "选择岗位后更新";
    elements.applicationHistory.append(
      makeTextElement("div", "application-history-empty", "还没有选择岗位。"),
    );
    return;
  }

  const normalized = normalizeJobApplication(job);
  elements.applicationStage.value = normalized.status;
  elements.applicationStage.disabled = false;
  elements.applicationNextAction.value = normalized.application.nextAction;
  elements.applicationNextAction.disabled = false;
  elements.applicationNextActionAt.value = dateInputValue(normalized.application.nextActionAt);
  elements.applicationNextActionAt.disabled = false;
  elements.applicationNote.value = "";
  elements.applicationNote.disabled = false;
  elements.updateApplication.disabled = false;
  elements.applicationStageUpdated.textContent = normalized.statusUpdatedAt
    ? formatDate(normalized.statusUpdatedAt)
    : "尚未更新";
  if (!normalized.application.history.length) {
    elements.applicationHistory.append(
      makeTextElement("div", "application-history-empty", "首次更新后会保留阶段时间线。"),
    );
    return;
  }
  for (const event of normalized.application.history.slice(0, 5)) {
    const item = document.createElement("article");
    item.dataset.stage = event.stage;
    const header = document.createElement("header");
    header.append(
      makeTextElement("strong", "", APPLICATION_STAGE_LABELS[event.stage] || "进度更新"),
      makeTextElement("span", "", formatDate(event.occurredAt)),
    );
    item.append(header);
    if (event.note) item.append(makeTextElement("p", "", event.note));
    if (event.nextAction) {
      item.append(
        makeTextElement(
          "small",
          "",
          `下一步 · ${event.nextAction}${event.nextActionAt ? ` · ${event.nextActionAt.slice(0, 10)}` : ""}`,
        ),
      );
    }
    elements.applicationHistory.append(item);
  }
}

function renderJobPoolDetail(job) {
  elements.jobDetailEmpty.hidden = Boolean(job);
  elements.jobDetailContent.hidden = !job;
  elements.jobDetailTriage.hidden = !job || job.status !== "inbox";
  elements.jobDetailInterest.disabled = !job || Boolean(context.busy);
  elements.jobDetailIgnore.disabled = !job || Boolean(context.busy);
  elements.deleteJob.disabled =
    !job || Boolean(context.busy) || projectContext.snapshotUnreadable;
  elements.discussJobSession.disabled = !job || Boolean(context.busy);
  elements.askAgent.disabled = !job || Boolean(context.busy);
  elements.openSourceJob.disabled = !job?.url;
  const originTrace = job ? latestTraceForArtifact("job", job.id) : null;
  elements.jobDetailTrace.disabled = !originTrace;
  elements.jobDetailTrace.dataset.inspectTraceId = originTrace?.id || "";

  if (!job) {
    elements.jobDetailHeaderState.textContent = "从左侧选择一个岗位";
    elements.jobDetailBadges.replaceChildren();
    elements.jobDetailDescription.textContent = "";
    elements.jobDetailVerification.hidden = true;
    return;
  }

  const completeness = normalizeJdCompleteness(job.jdCompleteness, job.description, true);
  const recency = resolveJobRecency(job);
  elements.jobDetailHeaderState.textContent = `${JD_COMPLETENESS_LABELS[completeness]} · ${recency.label}`;
  elements.jobDetailCompany.textContent = job.company || "公司待核验";
  elements.jobDetailStatus.textContent = APPLICATION_STAGE_LABELS[job.status] || "待筛选";
  elements.jobDetailStatus.dataset.status = job.status;
  elements.jobDetailTitle.textContent = job.title || "职位待核验";
  elements.jobDetailMeta.textContent = [
    job.location || "地点未注明",
    job.salary || "薪资未注明",
    job.employmentType || "",
  ]
    .filter(Boolean)
    .join(" · ");

  const source = makeTextElement("span", "source-badge", job.source || "来源待核验");
  const completenessBadge = makeTextElement(
    "span",
    "jd-completeness-badge",
    JD_COMPLETENESS_LABELS[completeness],
  );
  completenessBadge.dataset.completeness = completeness;
  const recencyBadge = makeTextElement("span", "job-recency-badge", recency.label);
  recencyBadge.dataset.recency = recency.state;
  elements.jobDetailBadges.replaceChildren(source, completenessBadge, recencyBadge);

  const description = String(job.description || "").trim();
  elements.jobDetailLength.textContent = description ? `${description.length} 字` : "暂无全文";
  elements.jobDetailDescription.textContent = description || "这条岗位目前只有列表信息。可以点击“问 Agent”继续核验完整 JD，或打开原始页查看。";
  elements.jobDetailVerification.hidden = !job.verificationNotes;
  elements.jobDetailVerification.textContent = job.verificationNotes
    ? `核验说明：${job.verificationNotes}`
    : "";
}

function renderInsights() {
  const job = selectedJob();
  renderJobPoolDetail(job);
  renderApplicationTracker(job);
  const keywords = extractKeywords(job);
  const matches = keywords.filter(keywordMatched);
  elements.matchScore.textContent = job ? `${calculateMatch(job)}%` : "--";
  elements.keywordCount.textContent = `${keywords.length} 项`;
  elements.coverageLabel.textContent = `${matches.length} / ${keywords.length}`;
  elements.keywordList.replaceChildren();
  elements.coverageList.replaceChildren();

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
}

function channelVerification(providerId) {
  return resolveChannelVerificationForSession(
    providerId,
    state.channelVerifications,
    context.sessionId,
  );
}

function channelVerificationSummary(providerIds) {
  const records = providerIds.map((providerId) => channelVerification(providerId));
  const ready = records.filter((record) => record.state === "ready");
  return {
    records,
    ready,
    pending: records.filter((record) => record.state !== "ready"),
    allReady: records.length > 0 && ready.length === records.length,
  };
}

function providerCookieAccounts(providerId) {
  return channelCookieAccounts.get(providerId) || [];
}

function providerSupportsManagedLogin(provider) {
  return Boolean(provider?.url) && Number(context.apiVersion || 0) >= 4;
}

async function loadProviderCookieAccounts(providerId, { force = false } = {}) {
  const provider = providerById(providerId);
  if (!providerSupportsManagedLogin(provider) || !context.cwd) return [];
  if (!force && channelCookieAccounts.has(providerId)) {
    return providerCookieAccounts(providerId);
  }
  if (channelCookieAccountLoads.has(providerId)) {
    return channelCookieAccountLoads.get(providerId);
  }
  const request = hostCall("credentials.cookies.list", { url: provider.url })
    .then((result) => {
      const accounts = Array.isArray(result?.accounts)
        ? result.accounts
            .filter(
              (account) =>
                account &&
                typeof account.id === "string" &&
                typeof account.label === "string",
            )
            .slice(0, 8)
        : [];
      channelCookieAccounts.set(providerId, accounts);
      return accounts;
    })
    .catch(() => {
      channelCookieAccounts.set(providerId, []);
      return [];
    })
    .finally(() => {
      channelCookieAccountLoads.delete(providerId);
      renderChannelVerifications();
    });
  channelCookieAccountLoads.set(providerId, request);
  return request;
}

function refreshChannelCookieAccounts({ force = false } = {}) {
  if (state.activeView !== "channels") return;
  let requested = false;
  for (const provider of providerCatalog()) {
    if (providerSupportsManagedLogin(provider)) {
      if (
        force ||
        (!channelCookieAccounts.has(provider.id) &&
          !channelCookieAccountLoads.has(provider.id))
      ) {
        requested = true;
      }
      void loadProviderCookieAccounts(provider.id, { force });
    }
  }
  if (requested) renderChannelVerifications();
}

async function setProviderEnabled(providerId, enabled) {
  if (!providerById(providerId)) return;
  const previous = clone(state.discoveryPreferences);
  const selected = new Set(currentDiscoveryPreferences().providers);
  if (enabled) selected.add(providerId);
  else selected.delete(providerId);
  state.discoveryPreferences = currentDiscoveryPreferences({
    ...state.discoveryPreferences,
    providers: [...selected],
  });
  persist();
  renderAll();
  if (!(await writeProjectSnapshot())) {
    state.discoveryPreferences = previous;
    persist();
    renderAll();
    notify("渠道启用状态无法写入当前项目", "error");
  }
}

async function loginAndSaveProvider(providerId) {
  const provider = providerById(providerId);
  if (!provider?.url) return notify("这个渠道还没有可登录的 HTTPS 入口", "error");
  if (!context.cwd) return notify("请先绑定当前求职数据项目", "error");
  if (Number(context.apiVersion || 0) < 4) {
    return notify("请重启到支持渠道登录的 CodeShell 版本", "error");
  }
  if (context.busy || activeChannelLoginProviderId || activeChannelVerificationProviderId) {
    return notify("请先完成当前渠道操作", "error");
  }
  activeChannelLoginProviderId = providerId;
  renderChannelVerifications();
  try {
    const result = await hostCall("credentials.cookies.loginAndSave", {
      providerId: provider.id,
      providerLabel: provider.label,
      url: provider.url,
    });
    if (!result?.ok) {
      if (!result?.cancelled) notify(result?.error || "登录没有保存成功", "error");
      return;
    }
    channelCookieAccounts.set(providerId, [result.credential]);
    if (!currentDiscoveryPreferences().providers.includes(providerId)) {
      await setProviderEnabled(providerId, true);
    }
    notify(`已保存 ${provider.label} 登录，正在检查当前状态`, "success");
  } catch (error) {
    notify(error instanceof Error ? error.message : "登录保存失败", "error");
    return;
  } finally {
    activeChannelLoginProviderId = "";
    renderChannelVerifications();
  }

  const bootstrap = currentProjectBootstrapStatus();
  if (bootstrap.state === "ready" && context.sessionId && !context.busy) {
    await verifyProviderInSession(providerId);
  } else {
    notify(`已保存 ${provider.label} 登录；初始化数据源后再验证`, "success");
  }
}

async function restoreProviderLogin(providerId, credentialId) {
  const provider = providerById(providerId);
  if (!provider || !credentialId) return;
  if (context.busy || activeChannelLoginProviderId || activeChannelVerificationProviderId) {
    return notify("请先完成当前渠道操作", "error");
  }
  activeChannelLoginProviderId = providerId;
  renderChannelVerifications();
  try {
    const result = await hostCall("credentials.cookies.restore", {
      credentialId,
      providerLabel: provider.label,
    });
    if (!result?.restored) return;
    if (!currentDiscoveryPreferences().providers.includes(providerId)) {
      await setProviderEnabled(providerId, true);
    }
    notify(`已恢复 ${provider.label} 登录，正在重新验证`, "success");
  } catch (error) {
    notify(error instanceof Error ? error.message : "保存的登录无法恢复", "error");
    return;
  } finally {
    activeChannelLoginProviderId = "";
    renderChannelVerifications();
  }
  await verifyProviderInSession(providerId);
}

function providerMark(provider) {
  if (provider.id === "linkedin") return "in";
  if (provider.id === "51job") return "51";
  return cleanText(provider.label, 2) || "渠";
}

function renderProviderPicker() {
  if (!elements.providerPicker) return;
  const selected = new Set(currentDiscoveryPreferences().providers);
  const legend = document.createElement("legend");
  legend.textContent = "招聘渠道";
  const options = providerCatalog().map((provider) => {
    const label = document.createElement("label");
    label.className = "source-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "providers";
    input.value = provider.id;
    input.checked = selected.has(provider.id);
    const copy = document.createElement("span");
    copy.title = `${provider.label} · ${provider.domain}`;
    copy.append(
      makeTextElement("i", "", providerMark(provider)),
      document.createTextNode(provider.label),
    );
    label.append(input, copy);
    return label;
  });
  elements.providerPicker.replaceChildren(legend, ...options);
}

function showAddChannelForm(show = true) {
  elements.addChannelForm.hidden = !show;
  elements.addChannelError.hidden = true;
  elements.addChannelError.textContent = "";
  if (show) {
    elements.customChannelName.focus();
  } else {
    elements.addChannelForm.reset();
  }
}

async function addCustomChannel(form) {
  if (!context.cwd) return notify("请先绑定当前求职数据项目", "error");
  const data = new FormData(form);
  const label = cleanText(data.get("channelName"), 80);
  const url = cleanText(data.get("channelUrl"), 1000);
  const previousProviders = clone(state.customProviders);
  const previousPreferences = clone(state.discoveryPreferences);
  const nextProviders = normalizeCustomProviders(
    [...state.customProviders, { label, url }],
    { reservedProviderIds: JOB_PROVIDERS.map((provider) => provider.id) },
  );
  const existingIds = new Set(state.customProviders.map((provider) => provider.id));
  const added = nextProviders.find((provider) => !existingIds.has(provider.id));
  if (!label || !url || !added) {
    elements.addChannelError.textContent =
      "请填写有效的 HTTPS 招聘页面；相同网址不能重复添加。";
    elements.addChannelError.hidden = false;
    return;
  }

  state.customProviders = nextProviders;
  state.discoveryPreferences = currentDiscoveryPreferences({
    ...state.discoveryPreferences,
    providers: [...state.discoveryPreferences.providers, added.id],
  });
  renderAll();
  const saved = await writeProjectSnapshot();
  if (!saved) {
    state.customProviders = previousProviders;
    state.discoveryPreferences = previousPreferences;
    renderAll();
    return notify("渠道无法保存到当前项目，请先恢复项目写入权限", "error");
  }
  persist();
  showAddChannelForm(false);
  renderAll();
  notify(`已添加 ${added.label}，现在可以单独验证`, "success");
}

async function removeCustomChannel(providerId) {
  const provider = state.customProviders.find((item) => item.id === providerId);
  if (!provider) return;
  if (activeChannelVerificationProviderId === providerId) {
    return notify("这个渠道正在验证，请完成后再删除", "error");
  }
  if (!window.confirm(`删除渠道“${provider.label}”？岗位池中的既有 JD 不会被删除。`)) return;
  const previous = {
    customProviders: clone(state.customProviders),
    discoveryPreferences: clone(state.discoveryPreferences),
    channelVerifications: clone(state.channelVerifications),
  };
  state.customProviders = state.customProviders.filter((item) => item.id !== providerId);
  state.discoveryPreferences = currentDiscoveryPreferences({
    ...state.discoveryPreferences,
    providers: state.discoveryPreferences.providers.filter((id) => id !== providerId),
  });
  state.channelVerifications = state.channelVerifications.filter(
    (record) => record.providerId !== providerId,
  );
  renderAll();
  const saved = await writeProjectSnapshot();
  if (!saved) {
    Object.assign(state, previous);
    renderAll();
    return notify("删除结果无法写入当前项目，请稍后重试", "error");
  }
  persist();
  notify(`已删除渠道 ${provider.label}`, "success");
}

function updateChannelVerification(providerId, stateId, detail) {
  if (!providerById(providerId)) throw new Error("未知招聘渠道");
  if (!CHANNEL_VERIFICATION_STATE_IDS.includes(stateId)) {
    throw new Error("渠道验证状态不正确");
  }
  const next = {
    providerId,
    state: stateId,
    checkedAt: new Date().toISOString(),
    sessionId: cleanText(context.sessionId, 160),
    detail: cleanText(detail, 1000),
  };
  state.channelVerifications = [
    ...state.channelVerifications.filter((record) => record.providerId !== providerId),
    next,
  ];
  return next;
}

function renderChannelVerifications() {
  if (!elements.channelVerificationList) return;
  const configured = new Set(currentDiscoveryPreferences().providers);
  const summary = channelVerificationSummary([...configured]);
  const savedLoginCount = providerCatalog().filter(
    (provider) => providerCookieAccounts(provider.id).length,
  ).length;
  elements.channelVerificationSummary.textContent = configured.size
    ? `${summary.ready.length} / ${configured.size} 已通过`
    : "尚未选择渠道";
  elements.channelVerificationSummary.dataset.state = summary.allReady ? "ready" : "pending";
  elements.channelNavCount.textContent = String(configured.size);
  elements.channelPageSummary.replaceChildren(
    makeTextElement("i", "", ""),
    document.createTextNode(
      ` ${configured.size} 个启用 · ${summary.ready.length} 个已验证 · ${savedLoginCount} 个已保存登录`,
    ),
  );
  elements.channelPageSummary.dataset.state = summary.allReady ? "ready" : "pending";
  elements.channelVerificationList.replaceChildren();
  const channelActionInProgress = Boolean(
    activeChannelVerificationProviderId || activeChannelLoginProviderId,
  );

  for (const provider of providerCatalog()) {
    const verification = channelVerification(provider.id);
    const accounts = providerCookieAccounts(provider.id);
    const account = accounts[0];
    const loginLoading = channelCookieAccountLoads.has(provider.id);
    const row = document.createElement("article");
    row.className = "channel-verification-row";
    row.dataset.state = verification.state;
    const identity = document.createElement("div");
    identity.className = "channel-verification-identity";
    identity.append(
      makeTextElement("strong", "", provider.label),
      makeTextElement("small", "", provider.domain),
    );
    const enabled = document.createElement("label");
    enabled.className = "channel-enabled-toggle";
    const enabledInput = document.createElement("input");
    enabledInput.type = "checkbox";
    enabledInput.checked = configured.has(provider.id);
    enabledInput.dataset.providerEnabledId = provider.id;
    enabledInput.disabled = Boolean(context.busy) || channelActionInProgress;
    enabled.append(enabledInput, document.createTextNode(enabledInput.checked ? "参与搜索" : "暂不搜索"));
    identity.append(enabled);
    const connection = document.createElement("div");
    connection.className = "channel-connection-result";
    const connectionReady = verification.state === "ready";
    const connectionLabel = connectionReady
      ? account
        ? "已登录，可抓取"
        : "当前任务可抓取"
      : account
        ? "登录已保存，等待验证"
        : CHANNEL_VERIFICATION_LABELS[verification.state] || "尚未连接";
    const badge = makeTextElement("span", "channel-verification-badge", connectionLabel);
    badge.dataset.state = connectionReady ? "ready" : verification.state;
    const connectionDetail = loginLoading
      ? "正在读取 CodeShell 中的脱敏登录状态"
      : account
        ? `${account.label} · ${verification.detail || "点击恢复后会自动验证"}`
        : verification.detail ||
          (provider.url
            ? "先验证公开访问；需要登录时再由 CodeShell 保存 Cookie"
            : "按具体公司招聘官网逐个处理");
    const detail = makeTextElement("small", "", connectionDetail);
    if (verification.checkedAt && verification.state !== "stale") {
      detail.title = `验证时间：${formatDate(verification.checkedAt)}`;
    }
    connection.append(badge, detail);
    if (provider.custom) {
      identity.append(makeTextElement("span", "custom-channel-label", "自定义渠道"));
    }
    const actions = document.createElement("div");
    actions.className = "channel-verification-actions";
    const actionDisabled = Boolean(context.busy) || channelActionInProgress || loginLoading;
    if (account && !connectionReady) {
      const primary = makeTextElement(
        "button",
        "button button-primary button-compact",
        activeChannelLoginProviderId === provider.id ? "正在恢复" : "恢复登录并验证",
      );
      primary.type = "button";
      primary.dataset.restoreProviderLoginId = provider.id;
      primary.dataset.credentialId = account.id;
      primary.disabled = actionDisabled;
      actions.append(primary);
    } else if (
      providerSupportsManagedLogin(provider) &&
      !account &&
      ["login_required", "captcha_required"].includes(verification.state)
    ) {
      const primary = makeTextElement(
        "button",
        "button button-primary button-compact",
        activeChannelLoginProviderId === provider.id ? "等待你登录" : "登录并保存",
      );
      primary.type = "button";
      primary.dataset.loginProviderId = provider.id;
      primary.disabled = actionDisabled;
      actions.append(primary);
    } else {
      const verify = makeTextElement(
        "button",
        connectionReady ? "button button-quiet button-compact" : "button button-primary button-compact",
        verification.state === "checking" && activeChannelVerificationProviderId === provider.id
          ? "验证中"
          : connectionReady
            ? "重新验证"
            : "验证渠道",
      );
      verify.type = "button";
      verify.dataset.verifyProviderId = provider.id;
      verify.disabled = actionDisabled;
      actions.append(verify);
    }
    if (providerSupportsManagedLogin(provider) && (account || connectionReady)) {
      const relogin = makeTextElement(
        "button",
        "channel-secondary-action",
        account ? "更换登录" : "保存登录",
      );
      relogin.type = "button";
      relogin.dataset.loginProviderId = provider.id;
      relogin.disabled = actionDisabled;
      actions.append(relogin);
    }
    if (provider.custom) {
      const remove = makeTextElement(
        "button",
        "button button-danger-quiet button-compact",
        "删除渠道",
      );
      remove.type = "button";
      remove.dataset.removeProviderId = provider.id;
      remove.disabled = Boolean(context.busy) || channelActionInProgress;
      actions.append(remove);
    }
    row.append(identity, connection, actions);
    elements.channelVerificationList.append(row);
  }
}

function discoveryAutomationSchedule(frequency, time) {
  const [hourText, minuteText] = String(time || "09:00").split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error("请选择有效的运行时间");
  }
  const day = frequency === "weekdays" ? "1-5" : frequency === "weekly" ? "1" : "*";
  return `${minute} ${hour} * * ${day}`;
}

function parseDiscoveryAutomationSchedule(schedule) {
  const match = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|1)$/u.exec(String(schedule || ""));
  if (!match) return null;
  const frequency = match[3] === "1-5" ? "weekdays" : match[3] === "1" ? "weekly" : "daily";
  return {
    frequency,
    time: `${String(Number(match[2])).padStart(2, "0")}:${String(Number(match[1])).padStart(2, "0")}`,
  };
}

function scheduledDiscoveryProviders() {
  return currentDiscoveryPreferences().providers
    .map((id) => providerById(id))
    .filter((provider) => provider && channelVerification(provider.id).state === "ready");
}

function scheduledDiscoveryPrompt(count) {
  const preferences = currentDiscoveryPreferences({
    ...state.discoveryPreferences,
    count,
  });
  const providers = scheduledDiscoveryProviders();
  const providerIds = providers.map((provider) => provider.id);
  const providerSummary = providers.map((provider) => `${provider.label}（${provider.domain}）`).join("、");
  return [
    DISCOVERY_AUTOMATION_MARKER,
    `TARGET_FULL_JDS=${count}`,
    `PROVIDER_IDS=${providerIds.join(",")}`,
    "这是求职作战室在当前项目和当前任务中创建的定时岗位发现。使用 job-hunt-hq:job-hunt-workflow 与 job-hunt-hq:job-intelligence Skills。",
    `从 ${providerSummary} 收集最多 ${count} 个新的完整 JD。关键词「${preferences.keyword || "从项目资料推断"}」，地点「${preferences.location || "不限"}」，经验「${preferences.seniority}」，最近 ${preferences.freshnessDays || "不限"} 天，工作方式「${WORK_MODE_LABELS[preferences.workMode] || WORK_MODE_LABELS.any}」。`,
    preferences.exclusions ? `明确排除：${preferences.exclusions}` : "无额外排除条件。",
    "先调用 get_job_search_context。只使用当前任务中仍为 ready 的上述渠道；登录失效、验证码或访问受限时写回真实渠道状态并跳过，不等待用户交互，不导出 Cookie，也不在浏览器外重放请求。",
    "列表卡片只用于建立候选。必须打开详情页，完整读取岗位职责与任职要求并核验当前有效性；不要用其他岗位或搜索摘要补齐。",
    "通过 save_job_opportunities 分批写回。面板会把不完整内容放入待补全线索，只有通过完整 JD 门槛的记录才进入正式岗位池并写到 career-data/jd/jobs/。线索不计入目标数量。",
    "同时把本次所有候选按 save_job_opportunities 的字段写成一个 JSON 收据，路径为 career-data/discovery/runs/<UTC时间>-scheduled.json；结构为 {schemaVersion:1, runId, generatedAt, source:'scheduled', jobs:[...]}。即使 Panel 工具暂时不可用也必须保留这份收据，面板下次打开会去重导入。不要直接改 job-hunt-panel.json。",
    "只做岗位发现，不生成简历、调研或面试题。最后分别报告新增完整 JD、更新岗位、待补全线索和受限渠道。",
  ].join("\n");
}

function renderDiscoveryAutomation() {
  if (!elements.discoveryAutomationPanel) return;
  const apiReady = Number(context.apiVersion || 0) >= 5;
  const projectReady = currentProjectBootstrapStatus().state === "ready" && Boolean(context.cwd);
  const readyProviders = scheduledDiscoveryProviders();
  const busy = discoveryAutomationActionPending || discoveryAutomationLoading;
  const canConfigure = apiReady && projectReady && readyProviders.length > 0 && !busy;
  for (const control of elements.discoveryAutomationForm.elements) control.disabled = !canConfigure;

  if (!apiReady) {
    elements.discoveryAutomationStatus.textContent = "需要重启新版 CodeShell";
    elements.discoveryAutomationDetail.textContent = "新版 Host 才能把定时任务安全绑定到当前项目和当前任务。";
  } else if (!projectReady) {
    elements.discoveryAutomationStatus.textContent = "等待项目初始化";
    elements.discoveryAutomationDetail.textContent = "先初始化求职数据项目，再开启定时抓取。";
  } else if (!readyProviders.length) {
    elements.discoveryAutomationStatus.textContent = "没有可用渠道";
    elements.discoveryAutomationDetail.textContent = "先把至少一个启用渠道连接到“已登录，可抓取”。";
  } else if (discoveryAutomationLoading) {
    elements.discoveryAutomationStatus.textContent = "正在读取任务";
    elements.discoveryAutomationDetail.textContent = "正在从 CodeShell 同步当前项目的定时任务。";
  } else if (discoveryAutomation) {
    elements.discoveryAutomationStatus.textContent = discoveryAutomation.enabled ? "运行中" : "已暂停";
    const nextRun = discoveryAutomation.nextRun ? formatDate(discoveryAutomation.nextRun) : "等待排期";
    elements.discoveryAutomationDetail.textContent = `${readyProviders.length} 个可用渠道 · 下次 ${nextRun} · 已运行 ${discoveryAutomation.runCount || 0} 次`;
  } else {
    elements.discoveryAutomationStatus.textContent = "尚未开启";
    elements.discoveryAutomationDetail.textContent = `${readyProviders.length} 个渠道已可用；任务会继续当前求职 Session 并复用其浏览器登录态。`;
  }

  elements.saveDiscoveryAutomation.textContent = discoveryAutomation ? "更新定时抓取" : "开启定时抓取";
  elements.discoveryAutomationActions.hidden = !discoveryAutomation;
  elements.toggleDiscoveryAutomation.textContent = discoveryAutomation?.enabled ? "暂停" : "继续";
  for (const button of elements.discoveryAutomationActions.querySelectorAll("button")) {
    button.disabled = busy;
  }
}

async function loadDiscoveryAutomation({ force = false } = {}) {
  if (state.activeView !== "channels" || Number(context.apiVersion || 0) < 5 || !context.cwd) return;
  if (!force && discoveryAutomationLoaded) return;
  if (discoveryAutomationLoading) return;
  discoveryAutomationLoading = true;
  renderDiscoveryAutomation();
  try {
    const result = await hostCall("automations.list", {});
    const automations = Array.isArray(result?.automations) ? result.automations : [];
    discoveryAutomation =
      automations.find((automation) =>
        String(automation?.prompt || "").includes(DISCOVERY_AUTOMATION_MARKER),
      ) || null;
    discoveryAutomationLoaded = true;
    if (discoveryAutomation) {
      const schedule = parseDiscoveryAutomationSchedule(discoveryAutomation.schedule);
      if (schedule) {
        elements.discoveryAutomationFrequency.value = schedule.frequency;
        elements.discoveryAutomationTime.value = schedule.time;
      }
      const target = /TARGET_FULL_JDS=(5|8|10)/u.exec(discoveryAutomation.prompt)?.[1];
      if (target) elements.discoveryAutomationCount.value = target;
    }
  } catch (error) {
    discoveryAutomationLoaded = true;
    discoveryAutomation = null;
    elements.discoveryAutomationDetail.textContent =
      error instanceof Error ? error.message : "定时任务读取失败";
  } finally {
    discoveryAutomationLoading = false;
    renderDiscoveryAutomation();
  }
}

async function saveDiscoveryAutomation() {
  if (discoveryAutomationActionPending) return;
  const providers = scheduledDiscoveryProviders();
  if (!providers.length) return notify("先连接至少一个启用渠道", "error");
  const count = Number(elements.discoveryAutomationCount.value);
  const schedule = discoveryAutomationSchedule(
    elements.discoveryAutomationFrequency.value,
    elements.discoveryAutomationTime.value,
  );
  const prompt = scheduledDiscoveryPrompt(count);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Singapore";
  discoveryAutomationActionPending = true;
  renderDiscoveryAutomation();
  try {
    discoveryAutomation = discoveryAutomation
      ? await hostCall("automations.update", {
          id: discoveryAutomation.id,
          name: `求职作战室 · ${state.discoveryPreferences.keyword || "定时找岗位"}`,
          schedule,
          prompt,
          timezone,
        })
      : await hostCall("automations.create", {
          name: `求职作战室 · ${state.discoveryPreferences.keyword || "定时找岗位"}`,
          schedule,
          prompt,
          timezone,
        });
    discoveryAutomationLoaded = true;
    notify("定时抓取已保存到当前求职项目", "success");
  } catch (error) {
    notify(error instanceof Error ? error.message : "定时抓取保存失败", "error");
  } finally {
    discoveryAutomationActionPending = false;
    renderDiscoveryAutomation();
  }
}

async function controlDiscoveryAutomation(action) {
  if (!discoveryAutomation || discoveryAutomationActionPending) return;
  if (action === "delete" && !window.confirm("删除这个项目的定时岗位抓取任务？已收集的 JD 不会删除。")) return;
  discoveryAutomationActionPending = true;
  renderDiscoveryAutomation();
  try {
    const method =
      action === "toggle"
        ? discoveryAutomation.enabled
          ? "automations.pause"
          : "automations.resume"
        : action === "run"
          ? "automations.runNow"
          : "automations.delete";
    await hostCall(method, { id: discoveryAutomation.id });
    if (action === "delete") discoveryAutomation = null;
    else if (action === "toggle") {
      discoveryAutomation = { ...discoveryAutomation, enabled: !discoveryAutomation.enabled };
    }
    notify(
      action === "run"
        ? "已启动一次岗位抓取"
        : action === "delete"
          ? "已删除定时抓取任务"
          : discoveryAutomation.enabled
            ? "已继续定时抓取"
            : "已暂停定时抓取",
      "success",
    );
  } catch (error) {
    notify(error instanceof Error ? error.message : "定时任务操作失败", "error");
  } finally {
    discoveryAutomationActionPending = false;
    renderDiscoveryAutomation();
  }
}

function renderJdInbox() {
  if (!elements.jdIntakeList) return;
  const counts = jdIntakeCounts(state.jdIntakeItems);
  elements.jdInboxTotal.textContent = String(counts.total);
  elements.jdInboxPending.textContent = String(counts.pending);
  elements.jdInboxImported.textContent = String(counts.imported);
  elements.jdInboxAttention.textContent = String(counts.attention);
  elements.addJdIntake.disabled = Boolean(context.busy) || jdIntakeSubmissionPending;
  elements.scanJdInbox.disabled = Boolean(context.busy) || jdIntakeSubmissionPending;
  elements.jdIntakeList.replaceChildren();

  const items = [...state.jdIntakeItems].sort((left, right) =>
    String(right.updatedAt || right.receivedAt).localeCompare(
      String(left.updatedAt || left.receivedAt),
    ),
  );
  for (const item of items.slice(0, 30)) {
    const card = document.createElement("article");
    card.className = "jd-intake-card";
    card.dataset.status = item.status;
    const copy = document.createElement("div");
    copy.className = "jd-intake-card-copy";
    const heading = document.createElement("div");
    heading.append(
      makeTextElement("strong", "", item.originalName || "JD 来源"),
      makeTextElement(
        "span",
        "jd-intake-status",
        JD_INTAKE_STATUS_LABELS[item.status] || "等待识别",
      ),
    );
    heading.lastElementChild.dataset.status = item.status;
    copy.append(
      heading,
      makeTextElement(
        "small",
        "",
        `${JD_INTAKE_SOURCE_LABELS[item.sourceKind] || "文件"}${item.sourcePath ? ` · ${item.sourcePath}` : ""}`,
      ),
      makeTextElement(
        "p",
        "",
        item.error || item.summary || "来源已登记，等待当前 Session 识别并写入岗位池。",
      ),
    );
    const actions = document.createElement("div");
    actions.className = "jd-intake-card-actions";
    for (const jobId of item.jobIds || []) {
      const job = state.jobs.find((candidate) => candidate.id === jobId);
      if (!job) continue;
      const open = makeTextElement("button", "button button-quiet button-compact", "查看岗位");
      open.type = "button";
      open.dataset.openIntakeJobId = jobId;
      open.title = `${job.company} · ${job.title}`;
      actions.append(open);
    }
    if (["staged", "needs_review", "failed"].includes(item.status)) {
      const process = makeTextElement(
        "button",
        "button button-primary button-compact",
        item.status === "staged" ? "识别并导入" : "重新识别",
      );
      process.type = "button";
      process.dataset.processIntakeId = item.id;
      process.disabled = Boolean(context.busy) || jdIntakeSubmissionPending;
      actions.append(process);
    }
    card.append(copy, actions);
    elements.jdIntakeList.append(card);
  }
  if (!items.length) {
    elements.jdIntakeList.append(
      makeTextElement(
        "div",
        "jd-intake-empty",
        "还没有 JD 来源。可以粘贴微信文字、选择截图或文件，也可以把文件放到项目收件箱后扫描。",
      ),
    );
  }
}

function renderMaterials() {
  elements.projectContextName.textContent = projectContext.name;
  elements.projectContextState.textContent = context.cwd ? "已绑定" : "未绑定";
  elements.codeshellFileState.textContent = projectContext.hasCodeshellFile
    ? "已发现"
    : "未发现";
  let snapshotLabel = "Agent 首次写回后创建";
  if (projectContext.snapshotUnreadable) snapshotLabel = "快照读取失败";
  else if (projectContext.snapshotDirty) {
    snapshotLabel = projectContext.hasSnapshot ? "有未同步修改" : "同步失败";
  } else if (projectContext.hasSnapshot) {
    snapshotLabel = `已同步${
      projectContext.lastSyncedAt ? ` · ${formatDate(projectContext.lastSyncedAt)}` : ""
    }`;
  }
  elements.projectSnapshotState.textContent = snapshotLabel;
  elements.projectSnapshotState.classList.toggle(
    "error",
    projectContext.snapshotDirty || projectContext.snapshotUnreadable,
  );
  elements.projectSnapshotState.title = projectContext.snapshotError || "";
  elements.projectSnapshotError.hidden = !projectContext.snapshotError;
  elements.projectSnapshotError.textContent = projectContext.snapshotError
    ? `${projectContext.snapshotError}。${
        projectContext.snapshotUnreadable
          ? "请先修复或备份这个文件，再重新读取；面板不会自动覆盖。"
          : "当前修改仍保留在本次打开的面板中，可以重试保存。"
      }`
    : "";
  elements.saveProjectSnapshot.hidden =
    !projectContext.snapshotDirty || projectContext.snapshotUnreadable;
  const bootstrap = currentProjectBootstrapStatus();
  const baseCount = baseResumes().length;
  const profileReady = Boolean(
    cleanText(state.profile.name, 120) &&
      !["等待 Agent 识别", "当前项目"].includes(cleanText(state.profile.name, 120)) &&
      (cleanText(state.profile.target, 300) || cleanText(state.profile.role, 200)),
  );
  const configuredProviders = currentDiscoveryPreferences().providers.length;
  const configuredProviderIds = currentDiscoveryPreferences().providers;
  const verifiedProviders = channelVerificationSummary(configuredProviderIds).ready.length;
  elements.sourceWorkspaceName.textContent = projectContext.name || "未绑定";
  elements.sourceWorkspaceState.textContent = context.cwd ? bootstrap.label : "未绑定工作区";
  elements.sourceProfileState.textContent = profileReady ? "个人资料已识别" : "个人资料待补充";
  elements.sourceExperienceState.textContent = `${state.experiences.length} 段工作经历`;
  elements.sourceRepoState.textContent = state.repos.length
    ? `${state.repos.length} 个 Repo / 项目证据`
    : "Repo 证据待连接";
  elements.sourceBaseState.textContent = baseCount
    ? `${baseCount} 份 Base Resume`
    : "尚未建立 Base";
  elements.sourceChannelState.textContent = configuredProviders
    ? `${verifiedProviders}/${configuredProviders} 当前 Session 已验证`
    : "尚未选择渠道";
  elements.sourceJdState.textContent = `${state.jobs.length} 个完整 JD · ${state.jobLeads.length} 条线索`;
  const bootstrapIndicator = document.createElement("i");
  bootstrapIndicator.setAttribute("aria-hidden", "true");
  elements.projectBootstrapSummary.replaceChildren(
    bootstrapIndicator,
    document.createTextNode(` ${context.busy ? "当前 Session 正在执行" : bootstrap.label}`),
  );
  elements.projectBootstrapSummary.dataset.state = context.busy
    ? "running"
    : bootstrap.state;
  elements.projectBootstrapTitle.textContent = bootstrap.title;
  elements.projectBootstrapDetail.textContent = bootstrap.detail;
  elements.initializeJobHuntProject.textContent = context.busy
    ? "Agent 正在工作"
    : bootstrap.button;
  elements.initializeJobHuntProject.disabled =
    Boolean(context.busy) || projectContext.snapshotUnreadable || !context.cwd;
  elements.showAddChannel.disabled =
    Boolean(context.busy) || projectContext.snapshotUnreadable || !context.cwd;
  for (const control of elements.addChannelForm.elements) {
    control.disabled = Boolean(context.busy);
  }
  renderProviderPicker();
  renderChannelVerifications();
  renderJdInbox();
  renderCareerFlow(bootstrap);
  renderDashboardFocus(bootstrap);
  elements.sideProfileName.textContent = state.profile.name;
  elements.sideProfileRole.textContent = state.profile.role;
  elements.sideProfileAvatar.replaceChildren();
  if (isSupportedResumePhoto(state.profile.photoDataUrl)) {
    const image = document.createElement("img");
    image.src = state.profile.photoDataUrl;
    image.alt = "";
    elements.sideProfileAvatar.append(image);
  } else {
    elements.sideProfileAvatar.textContent = candidateInitials();
  }
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
  if (!state.repos.length) {
    elements.repoList.append(
      makeTextElement(
        "div",
        "material-list-empty",
        "尚未识别项目证据。点击“初始化当前项目”，Agent 会从已有文件和当前 Git 仓库中核验。",
      ),
    );
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
  if (!state.experiences.length) {
    elements.experienceList.append(
      makeTextElement(
        "div",
        "material-list-empty",
        "尚未识别工作经历。初始化时会优先读取已有资料，没有资料文件时才创建待填写模板。",
      ),
    );
  }
}

function renderVersions() {
  elements.resumeVersionList.replaceChildren();
  const versions = resumeRecords();
  if (!versions.length) {
    const empty = document.createElement("article");
    empty.className = "resume-version-card";
    empty.append(
      makeTextElement("span", "panel-kicker", "NO DRAFTS YET"),
      makeTextElement("h2", "", "先建立第一份 Base Resume"),
      makeTextElement("p", "", "回到机会面板，填写求职大类。基础简历完成后，再选择岗位派生定制版。"),
    );
    elements.resumeVersionList.append(empty);
    return;
  }
  for (const version of versions) {
    const job = state.jobs.find((item) => item.id === version.jobId);
    const evidenceCoverage = resumeEvidenceCoverage(version.markdown, version.claimEvidence);
    const id = resumeRecordId(version);
    const current = id === resumeRecordId(state.resume);
    const card = document.createElement("article");
    card.className = `resume-version-card${current ? " current" : ""}`;
    const header = document.createElement("header");
    header.append(
      makeTextElement(
        "span",
        "panel-kicker",
        version.kind === "base"
          ? current
            ? "BASE · CURRENT"
            : "BASE RESUME"
          : current
            ? "JD VARIANT · CURRENT"
            : "JD VARIANT",
      ),
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
      makeTextElement(
        "p",
        "",
        version.kind === "base"
          ? `求职大类：${version.category} · Source ${evidenceCoverage.supported}/${evidenceCoverage.total}`
          : job
            ? `${job.company} · ${job.title} · Base：${version.category} · Source ${evidenceCoverage.supported}/${evidenceCoverage.total}`
            : `岗位待关联 · Base：${version.category} · Source ${evidenceCoverage.supported}/${evidenceCoverage.total}`,
      ),
      mini,
    );
    const actions = document.createElement("div");
    actions.className = "resume-version-actions";
    const openButton = makeTextElement(
      "button",
      "card-session-action",
      current ? "当前正在编辑" : "打开编辑",
    );
    openButton.type = "button";
    openButton.disabled = current;
    openButton.dataset.openResumeVersionId = id;
    const continueButton = makeTextElement("button", "card-session-action", "在 Session 继续 ↗");
    continueButton.type = "button";
    continueButton.dataset.sessionResumeVersionId = id;
    actions.append(openButton, continueButton);
    card.append(actions);
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

  const gapCounts = preparationGapCounts(plan?.gaps || []);
  elements.preparationGapSummary.replaceChildren();
  for (const kind of PREPARATION_GAP_KIND_IDS) {
    const badge = makeTextElement(
      "span",
      "preparation-gap-count",
      `${PREPARATION_GAP_KIND_LABELS[kind]} ${gapCounts[kind]}`,
    );
    badge.dataset.gapKind = kind;
    elements.preparationGapSummary.append(badge);
  }

  elements.preparationGapList.replaceChildren();
  for (const [gapIndex, gap] of (plan?.gaps || []).entries()) {
    const gapKind = normalizePreparationGapKind(gap.kind, gap);
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
    const kindBadge = makeTextElement(
      "span",
      "preparation-gap-kind",
      PREPARATION_GAP_KIND_LABELS[gapKind],
    );
    kindBadge.dataset.gapKind = gapKind;
    const sessionButton = makeTextElement("button", "inline-session-action", "补这个 ↗");
    sessionButton.type = "button";
    sessionButton.dataset.sessionGapIndex = String(gapIndex);
    actions.append(kindBadge, priority, sessionButton);
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
      makeTextElement("div", "interview-loop-empty", "还没有保存缺口诊断。"),
    );
  }

  const roadmap = (plan?.roadmap || []).map(normalizeRoadmapMilestone);
  elements.preparationRoadmapCount.textContent = `${roadmap.length} 阶段`;
  elements.preparationRoadmapList.replaceChildren();
  for (const [roadmapIndex, milestone] of roadmap.entries()) {
    const card = document.createElement("article");
    card.className = "roadmap-milestone";
    card.dataset.status = milestone.status;
    const header = document.createElement("header");
    const phase = makeTextElement("span", "roadmap-phase", milestone.phase);
    const status = makeTextElement(
      "span",
      "roadmap-status",
      ROADMAP_STATUS_LABELS[milestone.status],
    );
    status.dataset.status = milestone.status;
    const sessionButton = makeTextElement("button", "inline-session-action", "继续 ↗");
    sessionButton.type = "button";
    sessionButton.dataset.sessionRoadmapIndex = String(roadmapIndex);
    const statusActions = document.createElement("div");
    statusActions.className = "context-card-actions";
    statusActions.append(status, sessionButton);
    header.append(phase, statusActions);
    const meta = makeTextElement(
      "p",
      "roadmap-meta",
      [ROADMAP_KIND_LABELS[milestone.kind], milestone.duration].filter(Boolean).join(" · "),
    );
    const title = makeTextElement("strong", "", milestone.title);
    card.append(header, title, meta);
    if (milestone.objective) card.append(makeTextElement("p", "", milestone.objective));
    if (milestone.tasks.length) {
      const tasks = document.createElement("ul");
      for (const task of milestone.tasks) tasks.append(makeTextElement("li", "", task));
      card.append(tasks);
    }
    if (milestone.deliverable) {
      card.append(makeTextElement("p", "roadmap-deliverable", `产出：${milestone.deliverable}`));
    }
    if (milestone.successCriteria.length) {
      card.append(
        makeTextElement("p", "roadmap-success", `完成标准：${milestone.successCriteria.join("；")}`),
      );
    }
    elements.preparationRoadmapList.append(card);
  }
  if (!roadmap.length) {
    elements.preparationRoadmapList.append(
      makeTextElement(
        "div",
        "interview-loop-empty",
        gapCounts.skill
          ? "存在真实能力缺口，但还没有生成学习 Roadmap。"
          : "当前没有需要学习的真实能力缺口；资料与证据问题请按上方行动补齐。",
      ),
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
    const sourceMode = set.sourceMode || (set.jobId ? "jd" : "commits");
    const card = document.createElement("button");
    card.type = "button";
    card.className = `interview-set-card${set.id === state.selectedInterviewSetId ? " active" : ""}`;
    card.dataset.interviewSetId = set.id;
    card.append(
      makeTextElement(
        "span",
        "panel-kicker",
        sourceMode === "commits"
          ? "COMMIT DEEP DIVE"
          : INTERVIEW_MODE_LABELS[set.mode] || "定制面试",
      ),
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
  const sourceMode = set?.sourceMode || (set?.jobId ? "jd" : "commits");
  const questions = Array.isArray(set?.questions) ? set.questions : [];
  const categories = [...new Set(questions.map((item) => item.category).filter(Boolean))];
  const evidenceRefs = new Set(questions.flatMap((item) => item.evidenceRefs || []));

  elements.interviewJobLabel.textContent = job
    ? `${job.company} / ${job.title}${job.sample ? " · 示例 JD" : ""}`
    : sourceMode === "commits" && set
      ? "当前项目 / Commit 深挖"
      : "可从 JD 或当前项目 Commit 生成题单";
  elements.interviewSetTitle.textContent = set?.title || "还没有面试题单";
  elements.interviewQuestionCount.textContent = String(questions.length).padStart(2, "0");
  elements.interviewEvidenceCount.textContent = String(evidenceRefs.size).padStart(2, "0");
  elements.interviewCategoryCount.textContent = String(categories.length).padStart(2, "0");
  elements.simulateInterview.disabled = !set || Boolean(context.busy);
  elements.regenerateInterview.disabled =
    !set || Boolean(context.busy) || !isWorkflowEligibleStage(selectedJob()?.status);

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
        "系统可以把 JD、工作经历和 Repo 交叉起来，也可以直接从真实 Commit 设计项目深挖题。",
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
    evidence.append(
      ...refs.map((item) =>
        makeTextElement(
          "span",
          `evidence-chip${/^commit:/i.test(item) ? " commit" : ""}`,
          item,
        ),
      ),
    );

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
  elements.runCompanyResearch.disabled =
    Boolean(context.busy) || !isWorkflowEligibleStage(selectedJob()?.status);
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
  refreshChannelCookieAccounts();
  renderDiscoveryAutomation();
  void loadDiscoveryAutomation();
}

function composeDraft(job, category = "") {
  const keywords = job ? extractKeywords(job) : [];
  const matched = job
    ? keywords.filter(keywordMatched)
    : KEYWORD_RULES.map((rule) => rule.label)
        .filter(keywordMatched)
        .slice(0, 12);
  const targetCategory = normalizeResumeCategory(
    category,
    state.profile.target || state.profile.role,
  );
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
      : state.profile.summary
        ? `${state.profile.summary} 当前基础简历面向「${targetCategory}」方向。`
        : `面向「${targetCategory}」方向，请补充职业简介与核心价值。`,
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
  ].join("\n");
}

function buildLocalClaimEvidence(markdown) {
  return extractResumeClaims(markdown)
    .map((claim, index) => {
      const sources = [];
      const normalizedClaim = claim.toLocaleLowerCase();
      for (const experience of state.experiences) {
        const evidenceParts = [
          experience.company,
          experience.role,
          ...(experience.achievements || []),
        ].filter(Boolean);
        const evidence = evidenceParts
          .join(" ")
          .toLocaleLowerCase();
        if (!evidence.includes(normalizedClaim) && !normalizedClaim.includes(experience.company.toLocaleLowerCase())) {
          continue;
        }
        const matchedAchievement = (experience.achievements || []).find((achievement) =>
          achievement.toLocaleLowerCase().includes(normalizedClaim),
        );
        sources.push({
          kind: "experience",
          label: `${experience.company} · ${experience.role}`,
          locator: `experience:${experience.id || `${experience.company}-${experience.role}`}`,
          evidence:
            matchedAchievement ||
            `原始经历记录包含：${evidenceParts.slice(0, 4).join("；")}`,
        });
      }
      for (const repo of state.repos) {
        const evidence = [repo.name, repo.tech, repo.summary, repo.path]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();
        if (!evidence.includes(normalizedClaim) && !normalizedClaim.includes(repo.name.toLocaleLowerCase())) {
          continue;
        }
        sources.push({
          kind: "repository",
          label: repo.name,
          locator: repo.path ? `repo:${repo.path}` : `repo:${repo.id || repo.name}`,
          evidence: repo.summary || `项目技术信息：${repo.tech || "待进一步核验"}`,
        });
      }
      return sources.length
        ? {
            claim,
            status: "needs_review",
            importance: index < 4 ? "core" : "supporting",
            whyItMatters: "这条内容来自当前项目材料，但仍需 Agent 判断它对目标方向的区分度。",
            sources: sources.slice(0, 8),
            interviewQuestions: [
              {
                question: `请具体说明“${claim}”的背景、你个人采取的行动、关键取舍和结果。`,
                focus: "核验个人贡献边界、技术深度与实际结果",
              },
            ],
            improvement: "请让 Agent 读取 Source 原文，补充更精确的范围、行动和结果。",
          }
        : null;
    })
    .filter(Boolean);
}

function archiveCurrentResume() {
  if (!state.resume.markdown) return;
  const version = {
    id: state.resume.versionId || uid("resume"),
    kind: state.resume.kind,
    category: state.resume.category,
    baseResumeId: state.resume.baseResumeId || "",
    jobId: state.resume.jobId,
    title: state.resume.title,
    markdown: state.resume.markdown,
    style: normalizeResumeStyle(state.resume.style),
    pdfExports: Array.isArray(state.resume.pdfExports) ? state.resume.pdfExports : [],
    claimEvidence: state.resume.claimEvidence || [],
    notes: state.resume.notes || [],
    updatedAt: state.resume.updatedAt,
  };
  state.versions = [version, ...state.versions.filter((item) => item.id !== version.id)].slice(
    0,
    30,
  );
}

function activateResumeVersion(id) {
  const record = resumeRecords().find((item) => resumeRecordId(item) === id);
  if (!record || id === resumeRecordId(state.resume)) return;
  archiveCurrentResume();
  state.versions = state.versions.filter((item) => resumeRecordId(item) !== id);
  state.resume = {
    ...clone(record),
    versionId: id,
  };
  if (record.kind === "base") {
    state.selectedBaseResumeId = id;
  } else if (record.jobId && state.jobs.some((job) => job.id === record.jobId)) {
    state.selectedJobId = record.jobId;
    state.selectedBaseResumeId = record.baseResumeId || state.selectedBaseResumeId;
  }
  state.activeView = "resumes";
  resumeMode = "preview";
  persist();
  renderAll();
  void writeProjectSnapshot().then(() => renderMaterials());
}

function generateLocalDraft({ kind, category, baseResumeId = "" }) {
  const job = kind === "variant" ? selectedJob() : null;
  const markdown = composeDraft(job, category);
  if (state.resume.markdown) archiveCurrentResume();
  if (job) job.status = "tailoring";
  const now = new Date().toISOString();
  const versionId = uid("resume");
  state.resume = {
    kind,
    category,
    baseResumeId: kind === "variant" ? baseResumeId : "",
    jobId: job?.id || "",
    versionId,
    title: job ? `${job.company} · ${job.title}` : `${category} · Base Resume`,
    markdown,
    style: normalizeResumeStyle(state.resume.style),
    pdfExports: [],
    claimEvidence: buildLocalClaimEvidence(markdown),
    notes: ["请核对所有事实与日期", "建议补充至少一个可量化结果"],
    updatedAt: now,
  };
  if (kind === "base") state.selectedBaseResumeId = versionId;
  resumeMode = "preview";
  persist();
  renderAll();
  void writeProjectSnapshot().then(() => renderMaterials());
  notify(kind === "base" ? "基础简历已生成，可以继续编辑" : "岗位定制版已从 Base Resume 派生");
}

function requestedBaseCategory() {
  return normalizeResumeCategory(
    elements.resumeCategory.value,
    selectedBaseResume()?.category || state.profile.target || state.profile.role,
  );
}

async function initializeJobHuntProject() {
  if (context.busy) return notify("当前 Session 正在执行，请稍后再初始化", "error");
  if (!context.cwd) return notify("当前没有绑定 CodeShell 项目", "error");
  if (projectContext.snapshotUnreadable) {
    return notify("请先修复或备份无法读取的 job-hunt-panel.json", "error");
  }

  elements.initializeJobHuntProject.disabled = true;
  elements.initializeJobHuntProject.textContent = "正在准备项目";
  if (!projectContext.hasSnapshot || projectContext.snapshotDirty) {
    const saved = await writeProjectSnapshot();
    renderMaterials();
    if (!saved) {
      return notify("无法在当前项目创建面板数据，请检查项目写入权限", "error");
    }
  }

  const task = buildProjectBootstrapTask({
    workspace: context.cwd,
    projectName: projectContext.name,
    hasCodeshellFile: projectContext.hasCodeshellFile,
    hasSnapshot: projectContext.hasSnapshot,
    resumeEvidenceProtocol: RESUME_EVIDENCE_PROTOCOL,
  });

  elements.initializeJobHuntProject.disabled = true;
  elements.initializeJobHuntProject.textContent = "正在交给当前 Session";
  const sent = await submitSessionTask(
    task.prompt,
    task.displayText,
    task.metadata,
  );
  renderMaterials();
  return sent;
}

async function generateBaseDraft() {
  const category = requestedBaseCategory();
  const categoryKey = category.toLocaleLowerCase();
  const selectedBase = selectedBaseResume();
  const existingBase =
    (selectedBase?.category.toLocaleLowerCase() === categoryKey ? selectedBase : null) ||
    baseResumes().find((base) => base.category.toLocaleLowerCase() === categoryKey) ||
    null;
  if (!window.codeshellPanel?.call) {
    generateLocalDraft({ kind: "base", category });
    return;
  }
  const prompt = [
    "请同时使用 job-hunt-hq:job-hunt-workflow、job-hunt-hq:resume-writing 与 job-hunt-hq:resume-design skills，并用 panel-app:job-hunt-hq 工具生成或更新一份方向级 Base Resume。",
    `求职大类：${category}`,
    existingBase
      ? `当前选择的基础简历 ID：${resumeRecordId(existingBase)}。在它的真实内容上继续优化。`
      : "当前还没有基础简历，请先建立完整候选人基线。",
    "本次是基础简历任务，不绑定当前选中的 JD，也不要为了某一家公司的关键词重写经历。先确定一个招聘定位和 3 个最强证据信号，再写正文；没有重点或质量门槛低于 80 分时先重构后保存。",
    "先调用 get_job_search_context 读取项目上下文；项目中有 CODESHELL.md 时按它检查工作经历、项目说明、代码和其他候选人资料。",
    "若识别到候选人资料变化，调用 save_candidate_context 更新面板中的项目上下文。",
    "仅使用当前项目中能核实的事实；不要编造公司、日期、职责、技术或数字。对无法确认的信息放进 notes。",
    `完成后必须调用 save_resume_draft，传 resume_kind="base"、category="${category}"，省略 job_id，把完整 Markdown 写回面板。`,
    RESUME_EVIDENCE_PROTOCOL,
  ].join("\n");
  return submitSessionTask(prompt, "Agent 正在整理基础简历，完成后会自动显示", {
    instruction: `生成或更新「${category}」Base Resume，并为每条能力补齐 Source。`,
    target: {
      kind: "resume",
      title: `${category} · Base Resume`,
      detail: existingBase ? "更新已有基础简历" : "建立新的方向基础简历",
      payload: { resumeKind: "base", category, baseResumeId: resumeRecordId(existingBase) },
    },
  });
}

async function generateVariantDraft() {
  const job = selectedJob();
  const base = selectedBaseResume();
  if (!base) return notify("请先生成并选择一份 Base Resume", "error");
  if (!job) return notify("请选择要定制的岗位 JD", "error");
  if (!isWorkflowEligibleStage(job.status)) {
    return notify("这个 JD 还在待筛选；先标记感兴趣，再生成岗位定制版", "error");
  }
  const category = base.category;
  const baseResumeId = resumeRecordId(base);
  if (!window.codeshellPanel?.call) {
    generateLocalDraft({ kind: "variant", category, baseResumeId });
    return;
  }
  const prompt = [
    "请同时使用 job-hunt-hq:job-hunt-workflow、job-hunt-hq:resume-writing 与 job-hunt-hq:resume-design skills，并用 panel-app:job-hunt-hq 工具从已保存的 Base Resume 派生一份岗位定制简历。",
    `基础简历 ID：${baseResumeId}`,
    `基础方向：${category}`,
    `目标职位 ID：${job.id}`,
    "先调用 get_job_search_context，完整读取指定 Base Resume、目标 JD 和项目证据。",
    "保留基础简历中的真实事实与时间线，只调整摘要、排序、关键词覆盖和证据取舍；先把 JD 的高信号要求映射为强证据、邻近证据、证据缺口或真实能力缺口，不要把 JD 要求伪装成候选人经历。",
    `完成后必须调用 save_resume_draft，传 resume_kind="variant"、category="${category}"、base_resume_id="${baseResumeId}" 和 job_id="${job.id}"。`,
    RESUME_EVIDENCE_PROTOCOL,
    "JD 本身不能作为候选人能力的唯一 Source。",
  ].join("\n");
  return submitSessionTask(prompt, "Agent 正在从 Base Resume 派生岗位定制版", {
    instruction: `从「${category}」Base Resume 为 ${job.company} · ${job.title} 派生定制版。`,
    target: {
      kind: "resume",
      title: `${job.company} · ${job.title}`,
      detail: `从 ${category} Base 派生 JD Variant`,
      payload: { resumeKind: "variant", baseResumeId, jobId: job.id },
    },
  });
}

async function saveResumeToRepo() {
  const job = activeResumeJob();
  if (!state.resume.markdown) {
    return notify("当前视图还没有可保存的简历", "error");
  }
  const evidenceCoverage = resumeEvidenceCoverage(
    state.resume.markdown,
    state.resume.claimEvidence,
  );
  if (evidenceCoverage.missing.length || evidenceCoverage.missingDetails.length) {
    elements.resumeEvidenceLedger.open = true;
    return notify(
      `还有 ${evidenceCoverage.total - evidenceCoverage.complete} 条要点缺少完整的重点、证据说明或面试追问，请先让 Agent 补齐`,
      "error",
    );
  }
  const path = job
    ? `job-hunt-resume-${slugify(`${job.company}-${job.title}`)}.md`
    : `job-hunt-resume-base-${slugify(state.resume.category)}.md`;
  const evidencePath = path.replace(/\.md$/, ".evidence.json");
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
    const exportedMarkdown =
      normalizeResumeStyle(state.resume.style).template !== "minimal" &&
      isSupportedResumePhoto(state.profile.photoDataUrl)
      ? `<img src="${state.profile.photoDataUrl}" alt="${String(state.profile.name || "候选人").replaceAll('"', "")}照片" width="96" height="128" align="right" />\n\n${state.resume.markdown}`
      : state.resume.markdown;
    await hostCall("workspace.writeText", {
      path,
      content: exportedMarkdown,
      expectedModifiedAt,
      ...(expectedRevision ? { expectedRevision } : {}),
    });
    let evidenceModifiedAt = null;
    let evidenceRevision;
    try {
      const existingEvidence = await hostCall("workspace.readText", { path: evidencePath });
      evidenceModifiedAt = existingEvidence.modifiedAt;
      evidenceRevision = existingEvidence.revision;
    } catch {
      evidenceModifiedAt = null;
    }
    await hostCall("workspace.writeText", {
      path: evidencePath,
      content: `${JSON.stringify(
        {
          resumeVersionId: resumeRecordId(state.resume),
          resumeKind: state.resume.kind,
          category: state.resume.category,
          jobId: state.resume.jobId || null,
          style: normalizeResumeStyle(state.resume.style),
          updatedAt: state.resume.updatedAt,
          claimEvidence: state.resume.claimEvidence || [],
        },
        null,
        2,
      )}\n`,
      expectedModifiedAt: evidenceModifiedAt,
      ...(evidenceRevision ? { expectedRevision: evidenceRevision } : {}),
    });
    notify(`简历与证据账本已保存到 ${path} / ${evidencePath}`);
  } catch (error) {
    notify(error instanceof Error ? error.message : "保存到 Repo 失败", "error");
  }
}

function buildPublicResumePrintClone() {
  const clone = elements.resumePreview.cloneNode(true);
  clone.removeAttribute("id");
  clone.className = "resume-paper resume-print-paper";
  clone.querySelectorAll(".resume-point-proof").forEach((item) => item.remove());
  clone.querySelectorAll("button").forEach((item) => item.remove());
  clone.querySelector(".resume-photo-slot.placeholder")?.remove();
  return clone;
}

function resumePdfExportPath() {
  const now = new Date();
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  const timestamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    pad(now.getMilliseconds(), 3),
  ].join("");
  const identity = slugify(
    [state.profile.name, state.resume.title || state.resume.category].filter(Boolean).join("-"),
  );
  return `career-data/resumes/${identity}-${timestamp}.pdf`;
}

function preparePublicResumePrintView() {
  if (!state.resume.markdown.trim()) return notify("先生成或填写一份简历", "error");
  if (resumeMode === "edit") {
    state.resume.markdown = elements.resumeEditor.value;
    state.resume.updatedAt = new Date().toISOString();
    persist();
    renderResume();
    void writeProjectSnapshot().then(() => renderMaterials());
  }
  clearTimeout(resumePrintCleanupTimer);
  const originalTitle = document.title;
  const filename = [state.profile.name, state.resume.title || state.resume.category, "Resume"]
    .filter(Boolean)
    .join(" - ")
    .slice(0, 120);
  elements.resumePrintRoot.replaceChildren(buildPublicResumePrintClone());
  elements.resumePrintRoot.setAttribute("aria-hidden", "false");
  document.body.classList.add("printing-resume");
  document.title = filename || "Resume";
  const cleanup = () => {
    clearTimeout(resumePrintCleanupTimer);
    document.body.classList.remove("printing-resume");
    elements.resumePrintRoot.replaceChildren();
    elements.resumePrintRoot.setAttribute("aria-hidden", "true");
    document.title = originalTitle;
  };
  return cleanup;
}

function waitForResumePrintLayout() {
  const fontsReady = document.fonts?.ready || Promise.resolve();
  return fontsReady.then(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
}

function openSystemPdfFallback(cleanup) {
  window.addEventListener("afterprint", cleanup, { once: true });
  resumePrintCleanupTimer = setTimeout(cleanup, 60_000);
  try {
    notify("当前 CodeShell 需要重启后才能一键保存；已打开系统打印兜底");
    window.print();
  } catch (error) {
    cleanup();
    notify(error instanceof Error ? error.message : "无法打开打印窗口", "error");
  }
}

async function exportResumeToPdf() {
  const cleanup = preparePublicResumePrintView();
  if (!cleanup) return;
  const originalLabel = elements.printResume.textContent;
  elements.printResume.disabled = true;
  elements.printResume.textContent = "正在生成";
  try {
    await waitForResumePrintLayout();
    if (!window.codeshellPanel?.call || Number(context.apiVersion || 0) < 3) {
      openSystemPdfFallback(cleanup);
      return;
    }
    const path = resumePdfExportPath();
    const saved = await hostCall("workspace.exportPdf", {
      path,
      expectedModifiedAt: null,
    });
    const exportedAt = new Date().toISOString();
    state.resume.pdfExports = [
      { path, exportedAt, size: Number(saved?.size || 0) },
      ...(Array.isArray(state.resume.pdfExports) ? state.resume.pdfExports : []),
    ].slice(0, 12);
    persist({ quiet: false });
    renderResume();
    void writeProjectSnapshot().then(() => renderMaterials());
    notify(`PDF 已保存到当前项目：${path}`);
    cleanup();
  } catch (error) {
    const message = error instanceof Error ? error.message : "PDF 生成失败";
    if (/unknown Panel App method|unknown.*workspace\.exportPdf/i.test(message)) {
      openSystemPdfFallback(cleanup);
      return;
    }
    cleanup();
    notify(message, "error");
  } finally {
    elements.printResume.textContent = originalLabel;
    elements.printResume.disabled = !state.resume.markdown;
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

function openDeleteJobDialog(job) {
  const preview = jobRemovalPreview(state, job?.id);
  if (!preview) return notify("先选择要删除的 JD", "error");
  pendingDeleteJobId = preview.job.id;
  elements.deleteJobTarget.textContent = `${preview.job.company || "公司待核验"} · ${preview.job.title || "职位待核验"}`;
  const impact = [
    [preview.counts.research, "份公司情报"],
    [preview.counts.resumes, "份岗位定制简历"],
    [preview.counts.interviewSets, "套面试题"],
    [preview.counts.preparationPlans, "份准备计划"],
    [preview.counts.interviewDebriefs, "份面试复盘"],
  ]
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`);
  const stage = APPLICATION_STAGE_LABELS[preview.job.status] || "当前阶段";
  elements.deleteJobImpactSummary.textContent = impact.length
    ? `删除岗位记录、投递时间线，并同时清理：${impact.join("、")}。当前阶段：${stage}。`
    : `只删除岗位记录及其投递时间线。当前阶段：${stage}。`;
  openDialog("delete-job-dialog");
}

async function confirmDeleteJob() {
  if (context.busy) return notify("当前 Session 正在执行，请稍后再删除", "error");
  if (projectContext.snapshotUnreadable) {
    return notify("项目快照当前无法读取，请先修复或备份后再删除", "error");
  }
  const jobId = pendingDeleteJobId;
  const result = removeJobAndLinkedArtifacts(state, jobId, emptyProjectState().resume);
  if (!result.removed) {
    closeDialog("delete-job-dialog");
    pendingDeleteJobId = "";
    return notify("这条 JD 已经不在岗位池中");
  }
  state = result.next;
  state.activeView = "dashboard";
  if (sessionBridgeContext.payload?.jobId === jobId) {
    sessionBridgeContext = {
      kind: "panel",
      title: "当前求职面板",
      detail: "刚刚删除了一条 JD；可以继续筛选岗位池中的其他记录。",
      payload: {},
    };
  }
  resumeMode = "preview";
  pendingDeleteJobId = "";
  pendingJdFiles = [];
  jdIntakeSubmissionPending = false;
  activeJdIntakeIds = [];
  closeDialog("delete-job-dialog");
  persist();
  renderAll();
  const projectSaved = await writeProjectSnapshot();
  const label = `${result.removed.job.company || "公司待核验"} · ${result.removed.job.title || "职位待核验"}`;
  if (!projectSaved) {
    return notify(`已从当前面板删除 ${label}，但项目快照尚未同步，请在数据源页重试保存`, "error");
  }
  notify(
    result.removed.linkedArtifactCount
      ? `已删除 ${label}，并清理 ${result.removed.linkedArtifactCount} 个关联产物`
      : `已从岗位池删除 ${label}`,
  );
}

async function removeJobLead(leadId) {
  if (context.busy) return notify("当前 Session 正在执行，请稍后再删除", "error");
  const lead = state.jobLeads.find((item) => item.id === leadId);
  if (!lead) return notify("这条线索已经不存在");
  const label = `${lead.company || "公司待确认"} · ${lead.title || "岗位待确认"}`;
  if (!window.confirm(`删除线索“${label}”？这条记录还没有进入正式岗位池。`)) return;
  const previous = clone(state.jobLeads);
  state.jobLeads = state.jobLeads.filter((item) => item.id !== leadId);
  persist();
  renderAll();
  if (!(await writeProjectSnapshot())) {
    state.jobLeads = previous;
    persist();
    renderAll();
    return notify("线索删除结果无法写入当前项目", "error");
  }
  notify(`已删除待补全线索：${label}`);
}

async function completeJobLead(leadId) {
  const lead = state.jobLeads.find((item) => item.id === leadId);
  if (!lead) return notify("这条线索已经不存在", "error");
  const provider = providerById(lead.sourceId);
  if (provider?.url && provider.id !== "official") {
    const verification = channelVerification(provider.id);
    if (verification.state !== "ready") {
      state.activeView = "channels";
      persist();
      renderAll();
      return notify(`先在渠道管理完成 ${provider.label} 的登录与验证`, "error");
    }
  }
  const source = lead.url || lead.source || "保存的线索";
  await submitSessionTask(
    [
      "请使用 job-hunt-hq:job-hunt-workflow 与 job-hunt-hq:job-intelligence Skills，只补全下面这一条岗位线索。",
      `线索 ID：${lead.id}`,
      `公司：${lead.company || "待确认"}`,
      `岗位：${lead.title || "待确认"}`,
      `来源：${source}`,
      `当前缺口：${cleanTextList(lead.missingFields, 8, 120).join("、") || "完整岗位职责与任职要求"}`,
      "先调用 get_job_search_context。打开原始详情页并核验当前有效性，完整读取职责、任职要求及可见元数据。",
      "完成后调用 save_job_opportunities 写回同一 URL。只有完整 JD 才会晋级正式岗位池；仍不完整时继续保留为待补全线索，不要伪造缺失内容。",
      "只处理这一个岗位，不自动生成简历、公司调研或面试题。",
    ].join("\n"),
    `正在补全 ${lead.company || "目标公司"} · ${lead.title || "目标岗位"} 的完整 JD`,
    {
      instruction: `补全一条岗位线索：${lead.company || "公司待确认"} · ${lead.title || "岗位待确认"}`,
      target: {
        kind: "job-lead",
        title: `补全 JD · ${lead.company || "公司待确认"}`,
        detail: lead.title || lead.url || "待补全线索",
        payload: { leadId: lead.id, sourceId: lead.sourceId || "", url: lead.url || "" },
      },
    },
  );
}

async function resetJobHuntWorkspace() {
  if (context.busy) return notify("当前 Session 正在执行，请结束后再清空", "error");
  closeDialog("reset-dialog");
  clearTimeout(saveTimer);
  clearTimeout(projectSnapshotTimer);
  activeSessionTraceId = "";
  activeChannelVerificationProviderId = "";
  pendingDeleteJobId = "";
  focusedSessionTraceId = "";
  sessionBridgeParentTraceId = "";
  resumeMode = "preview";
  state = mergeState(emptyProjectState());
  state.discoveryReceiptCutoff = new Date().toISOString();
  projectContext.snapshotUnreadable = false;
  projectContext.snapshotDirty = true;
  projectContext.snapshotError = "";
  renderAll();

  try {
    await hostCall("storage.set", {
      key: STORAGE_KEY,
      value: compactPanelLocalState(state),
    });
    const saved = await writeProjectSnapshot();
    renderMaterials();
    if (!saved) throw new Error("无法重写当前项目的面板快照");
    notify("面板已清空；原始简历、经历、Repo 和项目文件均已保留");
  } catch (error) {
    notify(error instanceof Error ? error.message : "清空失败", "error");
  }
}

function showDashboardSection(target, statusFilter = "") {
  state.activeView = "dashboard";
  if (statusFilter) state.statusFilter = statusFilter;
  if (statusFilter) alignSelectedJobToCurrentFilter();
  persist();
  renderAll();
  requestAnimationFrame(() => target?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function runDashboardAction(action, jobId = "") {
  if (action === "materials") {
    state.activeView = "materials";
    persist();
    return renderAll();
  }
  if (action === "initialize") {
    state.activeView = "materials";
    persist();
    renderAll();
    return void initializeJobHuntProject();
  }
  if (action === "base") {
    state.activeView = "resumes";
    persist();
    renderAll();
    return void generateBaseDraft();
  }
  if (action === "discover") {
    populateJobSearchForm();
    return openDialog("agent-dialog");
  }
  if (action === "import") return openJdIntakeDialog();
  if (action === "inbox") {
    if (!state.jobs.length) {
      populateJobSearchForm();
      return openDialog("agent-dialog");
    }
    return showDashboardSection(elements.jobList, "inbox");
  }
  if (action === "compose" || action === "prepare") {
    elements.workflowDisclosure.open = true;
    return showDashboardSection(elements.workflowBuilder);
  }
  if (action === "run") return void runCustomWorkflowInSession();
  if (action === "job" || action === "followup") {
    const followupJob =
      state.jobs.find((job) => job.id === jobId) ||
      nextApplicationItem()?.job ||
      state.jobs.find((job) =>
        ["applied", "screening", "interviewing", "offer"].includes(job.status),
      );
    if (!followupJob) return notify("还没有需要跟进的岗位");
    state.selectedJobId = followupJob.id;
    return showDashboardSection(document.querySelector(".job-reader-panel"), "active");
  }
  return undefined;
}

function currentDiscoveryPreferences(input = state.discoveryPreferences) {
  return normalizeDiscoveryPreferences(input, {
    profile: state.profile,
    validProviderIds: validProviderIds(),
  });
}

function safeJdFileName(value, fallback = "jd-file") {
  const normalized = String(value || "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/^\.+/, "")
    .replace(/[. ]+$/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 120);
  return normalized || fallback;
}

function jdFileSourceKind(file) {
  const mime = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic)$/i.test(name)) return "image";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (/\.(docx?|rtf|pages)$/i.test(name) || /word|officedocument/.test(mime)) return "document";
  if (/微信|wechat|chat|聊天/i.test(name)) return "chat_export";
  return "file";
}

function renderPendingJdFiles() {
  elements.jdFileSelection.replaceChildren();
  for (const [index, file] of pendingJdFiles.entries()) {
    const item = document.createElement("span");
    item.className = "jd-file-chip";
    item.append(
      document.createTextNode(`${file.name || "剪贴板截图"} · ${Math.max(1, Math.ceil(file.size / 1024))} KB`),
    );
    const remove = makeTextElement("button", "", "×");
    remove.type = "button";
    remove.dataset.removeJdFileIndex = String(index);
    remove.setAttribute("aria-label", `移除 ${file.name || "文件"}`);
    item.append(remove);
    elements.jdFileSelection.append(item);
  }
  elements.jdFileSelection.hidden = pendingJdFiles.length === 0;
}

function addPendingJdFiles(files) {
  const incoming = [...(files || [])].filter((file) => file instanceof File);
  if (!incoming.length) return;
  const combined = [...pendingJdFiles];
  for (const file of incoming) {
    const duplicate = combined.some(
      (item) =>
        item.name === file.name &&
        item.size === file.size &&
        item.lastModified === file.lastModified,
    );
    if (!duplicate) combined.push(file);
  }
  if (combined.length > JD_UPLOAD_MAX_FILES) {
    return notify(`一次最多添加 ${JD_UPLOAD_MAX_FILES} 个文件`, "error");
  }
  const totalBytes = combined.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > JD_UPLOAD_MAX_TOTAL_BYTES) {
    return notify("本次文件合计不能超过 5 MB", "error");
  }
  pendingJdFiles = combined;
  renderPendingJdFiles();
}

function openJdIntakeDialog() {
  if (!context.cwd) return notify("请先绑定并初始化求职数据项目", "error");
  pendingJdFiles = [];
  document.querySelector("#job-form")?.reset();
  renderPendingJdFiles();
  openDialog("job-dialog");
}

async function writeNewWorkspaceText(path, content) {
  return hostCall("workspace.writeText", {
    path,
    content,
    expectedModifiedAt: null,
  });
}

async function upsertWorkspaceText(path, content) {
  let expectedModifiedAt = null;
  let expectedRevision;
  try {
    const existing = await hostCall("workspace.readText", { path });
    expectedModifiedAt = existing.modifiedAt;
    expectedRevision = existing.revision;
  } catch {
    expectedModifiedAt = null;
  }
  return hostCall("workspace.writeText", {
    path,
    content,
    expectedModifiedAt,
    ...(expectedRevision ? { expectedRevision } : {}),
  });
}

function formalJdPath(job) {
  return `career-data/jd/jobs/${safeJdFileName(job.id, "job")}.md`;
}

function formalJdMarkdown(job) {
  return [
    `# ${job.title || "岗位 JD"}`,
    "",
    `- 公司：${job.company || "待确认"}`,
    `- 地点：${job.location || "未注明"}`,
    `- 薪资：${job.salary || "未注明"}`,
    `- 来源：${job.source || "未注明"}`,
    `- 原始链接：${job.url || "无（聊天、猎头或文件来源）"}`,
    `- 发布时间：${job.publishedAt || "未注明"}`,
    `- 核验时间：${job.fetchedAt || job.updatedAt || "未注明"}`,
    "",
    "## 完整 JD",
    "",
    String(job.description || "").trim(),
    "",
    "## 核验说明",
    "",
    job.verificationNotes || "已通过面板完整 JD 门槛：正文包含岗位职责与任职要求。",
    "",
  ].join("\n");
}

async function ensureJdInboxReadme() {
  const path = `${JD_INBOX_PATH}/README.md`;
  try {
    await hostCall("workspace.readText", { path });
  } catch {
    await writeNewWorkspaceText(
      path,
      [
        "# JD Inbox",
        "",
        "把微信截图、PDF、Word、聊天导出或文本 JD 放到这个目录。",
        "回到 Job Hunt HQ 的“数据源 → JD 收件箱”点击“扫描项目收件箱”。",
        "Agent 只把识别成功的岗位写入岗位池，并保留这个文件路径作为 Source。",
        "",
      ].join("\n"),
    );
  }
  return path;
}

async function blobBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const value = String(reader.result || "");
      resolve(value.slice(value.indexOf(",") + 1));
    });
    reader.addEventListener("error", () => reject(reader.error || new Error("文件读取失败")));
    reader.readAsDataURL(blob);
  });
}

async function fileSha256(file) {
  if (!globalThis.crypto?.subtle) return "";
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function stageJdFile(file, sourceLabel) {
  const intakeId = uid("jd-intake");
  const safeName = safeJdFileName(file.name, `${intakeId}.bin`);
  const attachmentRoot = `${JD_INBOX_PATH}/_attachments/${intakeId}`;
  const parts = [];
  for (let offset = 0, index = 0; offset < file.size; offset += JD_UPLOAD_CHUNK_BYTES, index += 1) {
    const partPath = `${attachmentRoot}/part-${String(index + 1).padStart(3, "0")}.txt`;
    const content = await blobBase64(file.slice(offset, offset + JD_UPLOAD_CHUNK_BYTES));
    await writeNewWorkspaceText(partPath, content);
    parts.push(partPath);
  }
  const manifestPath = `${attachmentRoot}/manifest.json`;
  const reconstructedPath = `${JD_INBOX_PATH}/received/${intakeId}-${safeName}`;
  await writeNewWorkspaceText(
    manifestPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        intakeId,
        originalName: file.name || safeName,
        mimeType: file.type || "application/octet-stream",
        byteSize: file.size,
        sha256: await fileSha256(file),
        encoding: "base64-chunks",
        parts,
        reconstructedPath,
        sourceLabel,
        receivedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  return {
    id: intakeId,
    sourceKind: jdFileSourceKind(file),
    originalName: file.name || "剪贴板截图",
    sourcePath: manifestPath,
    status: "staged",
    summary: `来源：${sourceLabel}；文件已安全暂存，等待识别`,
    jobIds: [],
    receivedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: "",
  };
}

async function stagePastedJd(rawText, sourceLabel, url) {
  const intakeId = uid("jd-intake");
  const path = `${JD_INBOX_PATH}/${intakeId}-pasted-jd.md`;
  await writeNewWorkspaceText(
    path,
    [
      "# Pasted JD source",
      "",
      `- Source: ${sourceLabel}`,
      `- Received: ${new Date().toISOString()}`,
      url ? `- URL: ${url}` : "- URL: not provided",
      "",
      "## Original content",
      "",
      rawText,
      "",
    ].join("\n"),
  );
  return {
    id: intakeId,
    sourceKind: "pasted_text",
    originalName: `${sourceLabel} · 粘贴文字`,
    sourcePath: path,
    status: "staged",
    summary: url ? `原始链接：${url}` : "已保留原始粘贴文字",
    jobIds: [],
    receivedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: "",
  };
}

async function processJdIntakeItems(intakeIds) {
  const ids = [...new Set(intakeIds)].filter(Boolean);
  const items = state.jdIntakeItems.filter((item) => ids.includes(item.id));
  if (!items.length) return notify("没有可识别的 JD 来源", "error");
  if (context.busy) return notify("当前 Session 正在执行，来源已保存在 JD 收件箱", "error");
  const now = new Date().toISOString();
  state.jdIntakeItems = state.jdIntakeItems.map((item) =>
    ids.includes(item.id)
      ? { ...item, status: "processing", updatedAt: now, error: "" }
      : item,
  );
  activeJdIntakeIds = ids;
  persist();
  renderJdInbox();
  const intakeStateSaved = await writeProjectSnapshot();
  if (!intakeStateSaved) {
    activeJdIntakeIds = [];
    state.jdIntakeItems = state.jdIntakeItems.map((item) =>
      ids.includes(item.id) ? { ...item, status: "staged", updatedAt: now } : item,
    );
    renderJdInbox();
    return notify("JD 收件箱状态无法写入当前项目，请先恢复项目写入权限", "error");
  }
  const sourcePayload = items.map((item) => ({
    intakeId: item.id,
    sourceKind: item.sourceKind,
    originalName: item.originalName,
    sourcePath: item.sourcePath,
  }));
  const prompt = [
    "请使用 job-hunt-hq:job-hunt-workflow 与 job-hunt-hq:job-intelligence Skills，并用 panel-app:job-hunt-hq 工具处理 JD 收件箱来源。",
    "先调用 get_job_search_context。只处理下面列出的 intakeId 和 sourcePath，不扫描其他 Repo，也不要扩展到简历、公司调研或面试题。",
    `待处理来源：${JSON.stringify(sourcePayload)}`,
    "普通文本文件直接读取。若 sourcePath 指向 _attachments/*/manifest.json：读取 manifest，按 parts 顺序拼接 base64，严格写到 manifest.reconstructedPath，校验 byteSize 与 sha256 后再解析；不要写到项目外。",
    "根据文件类型读取文字、截图、PDF、Word 或聊天导出。一个来源可以包含零个、一个或多个岗位；保留原始文件路径、链接、可见日期和不确定项。",
    "多张连续截图可能属于同一份 JD：仅在公司、职位、上下文和顺序能明确对应时合并，并让这些 intakeId 关联同一个 job_id；不能确认时标记 needs_review。",
    "识别出候选内容后先调用 save_job_opportunities。面板只会把包含完整职责与任职要求的 JD 放入正式岗位池；片段会进入待补全线索，不能生成 job_id。",
    "再调用 save_jd_intake_results：只有返回真实 job_id 的完整 JD 才标记 imported；只有线索、OCR 不全或页序不确定时标记 needs_review；重复或失败按实际结果写回。即使没有识别成功也必须写回结果，不能只留下 Trace。",
    "完整 JD 进入待筛选岗位池也不代表感兴趣或准备投递。",
  ].join("\n");
  const sent = await submitSessionTask(prompt, "JD 来源已交给当前 Session 识别", {
    instruction: `识别并导入 ${items.length} 个 JD 收件箱来源。`,
    target: {
      kind: "jd-intake",
      title: `JD 收件箱 · ${items.length} 个来源`,
      detail: items.map((item) => item.originalName).join("；").slice(0, 500),
      payload: { intakeIds: ids },
    },
  });
  if (!sent || !window.codeshellPanel?.call) {
    activeJdIntakeIds = [];
    state.jdIntakeItems = state.jdIntakeItems.map((item) =>
      ids.includes(item.id)
        ? {
            ...item,
            status: "staged",
            updatedAt: new Date().toISOString(),
            summary: sent
              ? "浏览器预览不会执行识别；安装到 CodeShell 后点击“识别并导入”"
              : "识别任务未发送，来源仍保留在收件箱",
          }
        : item,
    );
    persist();
    renderJdInbox();
    void writeProjectSnapshot();
  }
}

async function submitJdIntakeForm(form) {
  if (jdIntakeSubmissionPending) return;
  if (!context.cwd) return notify("请先绑定并初始化求职数据项目", "error");
  if (context.busy) return notify("当前 Session 正在执行，请稍后再添加 JD", "error");
  const data = new FormData(form);
  const rawText = cleanText(data.get("rawText"), 50000);
  const sourceLabel = cleanText(data.get("source"), 120) || "手动导入";
  const url = cleanText(data.get("url"), 1000);
  if (!rawText && !pendingJdFiles.length) {
    return notify("请粘贴 JD 文字，或选择文件 / 截图", "error");
  }
  jdIntakeSubmissionPending = true;
  elements.submitJdIntake.disabled = true;
  elements.submitJdIntake.textContent = "正在保存来源";
  const staged = [];
  try {
    if (rawText) staged.push(await stagePastedJd(rawText, sourceLabel, url));
    for (const file of pendingJdFiles) staged.push(await stageJdFile(file, sourceLabel));
    state.jdIntakeItems = upsertJdIntakeItems(state.jdIntakeItems, staged);
    pendingJdFiles = [];
    form.reset();
    closeDialog("job-dialog");
    state.activeView = "materials";
    persist();
    renderAll();
    requestAnimationFrame(() =>
      elements.jdInboxPanel?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
    await processJdIntakeItems(staged.map((item) => item.id));
  } catch (error) {
    notify(error instanceof Error ? error.message : "JD 来源保存失败", "error");
  } finally {
    jdIntakeSubmissionPending = false;
    elements.submitJdIntake.disabled = Boolean(context.busy);
    elements.submitJdIntake.textContent = "保存来源并识别";
    renderJdInbox();
  }
}

async function scanProjectJdInbox() {
  if (context.busy) return notify("当前 Session 正在执行，请稍后扫描", "error");
  if (!context.cwd) return notify("请先绑定并初始化求职数据项目", "error");
  try {
    await ensureJdInboxReadme();
  } catch (error) {
    return notify(error instanceof Error ? error.message : "无法建立 JD 收件箱", "error");
  }
  const now = new Date().toISOString();
  const scan = {
    id: uid("jd-scan"),
    sourceKind: "project_scan",
    originalName: "项目 JD 收件箱扫描",
    sourcePath: JD_INBOX_PATH,
    status: "staged",
    summary: "等待扫描项目收件箱中的新增文件",
    jobIds: [],
    receivedAt: now,
    updatedAt: now,
    error: "",
  };
  state.jdIntakeItems = upsertJdIntakeItems(state.jdIntakeItems, [scan]);
  state.activeView = "materials";
  persist();
  renderAll();
  await writeProjectSnapshot();
  requestAnimationFrame(() =>
    elements.jdInboxPanel?.scrollIntoView({ behavior: "smooth", block: "start" }),
  );
  await processJdIntakeItems([scan.id]);
}

function showChannelVerificationPanel() {
  const form = document.querySelector("#agent-search-form");
  const dialog = document.querySelector("#agent-dialog");
  if (form instanceof HTMLFormElement && dialog?.open) {
    const data = new FormData(form);
    state.discoveryPreferences = currentDiscoveryPreferences({
      keyword: data.get("keyword"),
      location: data.get("location"),
      seniority: data.get("seniority"),
      count: data.get("count"),
      freshnessDays: data.get("freshnessDays"),
      workMode: data.get("workMode"),
      exclusions: data.get("exclusions"),
      providers: data
        .getAll("providers")
        .map((value) => String(value))
        .filter((id) => providerById(id)),
      lastRunAt: state.discoveryPreferences.lastRunAt,
    });
    void writeProjectSnapshot();
  }
  closeDialog("agent-dialog");
  state.activeView = "channels";
  persist();
  renderAll();
  requestAnimationFrame(() => {
    elements.channelVerificationPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
    elements.channelVerificationPanel
      ?.querySelector("[data-verify-provider-id]:not(:disabled)")
      ?.focus();
  });
}

async function verifyProviderInSession(providerId) {
  const provider = providerById(providerId);
  if (!provider) return notify("这个招聘渠道不存在", "error");
  if (context.busy) return notify("当前 Session 正在执行，请完成后再验证渠道", "error");
  if (!context.sessionId) return notify("还没有绑定当前 Session", "error");
  const bootstrap = currentProjectBootstrapStatus();
  if (bootstrap.state !== "ready" || !context.cwd) {
    return notify("请先初始化求职数据源，再验证渠道", "error");
  }
  if (activeChannelVerificationProviderId) {
    const running = providerById(activeChannelVerificationProviderId);
    return notify(`请先完成 ${running?.label || "当前渠道"} 的验证`, "error");
  }
  if (activeChannelLoginProviderId) {
    const running = providerById(activeChannelLoginProviderId);
    return notify(`请先完成 ${running?.label || "当前渠道"} 的登录`, "error");
  }

  const previous = state.channelVerifications.find((record) => record.providerId === providerId);
  activeChannelVerificationProviderId = providerId;
  updateChannelVerification(
    providerId,
    "checking",
    `正在通过 CodeShell 浏览器打开 ${provider.label}，只检查访问与登录状态`,
  );
  persist();
  renderMaterials();
  renderDiscoveryPreflight();
  const projectSaved = await writeProjectSnapshot();
  if (!projectSaved) {
    activeChannelVerificationProviderId = "";
    state.channelVerifications = state.channelVerifications.filter(
      (record) => record.providerId !== providerId,
    );
    if (previous) state.channelVerifications.push(previous);
    renderMaterials();
    return notify("验证状态无法写入当前项目，请先恢复项目写入权限", "error");
  }

  const prompt = [
    "请使用 job-hunt-hq:job-hunt-workflow skill 和 panel-app:job-hunt-hq 工具，只验证一个招聘渠道。",
    `本次唯一渠道：${provider.label}（${provider.domain}）；provider_id=\"${provider.id}\"。`,
    provider.url
      ? `本次验证入口：${provider.url}。必须从这个精确网址开始，不要替换成同名网站。`
      : "本次渠道没有固定入口；只检查请求中明确给出的公司招聘官网。",
    "先调用 get_job_search_context，确认当前 Session 与项目绑定，然后只在当前 Session 的可见浏览器里打开这个渠道。",
    "本次不要搜索岗位、不要查看其他渠道、不要保存 JD。只判断当前页面是否可正常访问，以及当前是否具备后续搜索所需的登录状态。",
    "本次只读取当前任务浏览器已有的登录态，不调用 UseCredential 或 InjectCredential。需要登录时写回 login_required；用户会回到渠道管理点击“登录并保存”或“恢复并验证”。",
    "结果只能归类为 ready、login_required、captcha_required、blocked 或 unavailable。必须调用 save_channel_verification 写回 provider_id、status 和用户能看懂的 detail。",
    "如果需要我处理登录或验证码，停留在可见页面并写回对应状态；不要代替我输入账号、密码或验证码。",
    "当前任务的浏览器分区由 CodeShell 持久化，应用重启后可以继续使用其中的登录态；面板和 Agent 都不得读取、导出、复制或物化 Cookie，也不要使用 shell、curl 或浏览器外 HTTP 客户端重放登录请求。",
    "最终回复只能陈述实际完成且工具返回成功的 Panel 写回。最后一次浏览器观察之后，必须真实调用 save_channel_verification；有 Panel Trace ID 时还必须真实调用 complete_execution_trace，禁止只在文字里声称已写回或已完成 Trace。",
  ].join("\n");
  const sent = await submitSessionTask(
    prompt,
    `${provider.label} 验证已发送到当前 Session`,
    {
      instruction: `只验证 ${provider.label} 的访问与登录状态。`,
      target: {
        kind: "channel-verification",
        title: `${provider.label} · 渠道验证`,
        detail: `只验证 ${provider.domain}，不搜索岗位`,
        payload: {
          providerId: provider.id,
          loginMode: "visible",
        },
      },
    },
  );
  if (!sent || !window.codeshellPanel?.call) {
    activeChannelVerificationProviderId = "";
    updateChannelVerification(
      providerId,
      "unchecked",
      sent ? "浏览器预览不会执行验证，请安装到 CodeShell 后重试" : "验证任务未发送",
    );
    persist();
    renderMaterials();
    renderChannelVerifications();
    renderDiscoveryPreflight();
    renderDiscoveryAutomation();
    void writeProjectSnapshot();
  }
}

function populateJobSearchForm() {
  const form = document.querySelector("#agent-search-form");
  if (!(form instanceof HTMLFormElement)) return;
  const preferences = currentDiscoveryPreferences();
  for (const [name, value] of Object.entries({
    keyword: preferences.keyword,
    location: preferences.location,
    seniority: preferences.seniority,
    count: String(preferences.count),
    freshnessDays: String(preferences.freshnessDays),
    workMode: preferences.workMode,
    exclusions: preferences.exclusions,
  })) {
    const control = form.elements.namedItem(name);
    if (control && "value" in control) control.value = value;
  }
  form.querySelectorAll('input[name="providers"]').forEach((checkbox) => {
    checkbox.checked = preferences.providers.includes(checkbox.value);
  });
  renderDiscoveryPreflight();
}

function renderDiscoveryPreflight() {
  const bootstrap = currentProjectBootstrapStatus();
  const projectReady = bootstrap.state === "ready" && Boolean(context.cwd);
  elements.searchProjectPreflight.dataset.state = context.busy
    ? "checking"
    : bootstrap.state;
  elements.searchProjectPreflightStatus.textContent = context.busy
    ? "Session 执行中"
    : projectReady
      ? "已初始化"
      : bootstrap.label;
  elements.searchProjectPreflightDetail.textContent = projectReady
    ? "已找到 CODESHELL.md、可读项目快照和候选人资料；不要求先有 Base Resume。"
    : bootstrap.detail;
  elements.searchPreflightInitialize.hidden = projectReady;
  elements.searchPreflightInitialize.disabled = Boolean(context.busy) || !context.cwd;

  const form = document.querySelector("#agent-search-form");
  const selectedProviders = form
    ? [...form.querySelectorAll('input[name="providers"]:checked')]
        .map((checkbox) => providerById(checkbox.value))
        .filter(Boolean)
    : [];
  const verification = channelVerificationSummary(
    selectedProviders.map((provider) => provider.id),
  );
  elements.searchLoginPreflight.dataset.state = verification.allReady ? "ready" : "pending";
  if (!selectedProviders.length) {
    elements.searchLoginPreflightStatus.textContent = "先选择渠道";
    elements.searchLoginPreflightDetail.textContent =
      "每个渠道都要在当前 Session 单独验证，包括公司官网。";
  } else if (verification.allReady) {
    elements.searchLoginPreflightStatus.textContent = `${verification.ready.length} 个渠道已验证`;
    elements.searchLoginPreflightDetail.textContent =
      "所选渠道都已在当前 Session 通过，可以开始搜索。";
  } else {
    const pendingLabels = verification.pending.map((record) => {
      const provider = providerById(record.providerId);
      return `${provider?.label || record.providerId}（${CHANNEL_VERIFICATION_LABELS[record.state] || "未验证"}）`;
    });
    elements.searchLoginPreflightStatus.textContent = `还需验证 ${verification.pending.length} 个`;
    elements.searchLoginPreflightDetail.textContent = pendingLabels.join("、");
  }

  elements.searchVerifyChannels.hidden =
    !selectedProviders.length || verification.allReady;
  elements.searchVerifyChannels.disabled = Boolean(context.busy);

  elements.submitJobSearch.disabled =
    Boolean(context.busy) || !projectReady || !verification.allReady;
  elements.submitJobSearch.textContent = context.busy
    ? "Agent 正在工作"
    : !projectReady
      ? "先建立数据源"
      : verification.allReady
        ? "搜索已验证渠道"
        : "先逐个验证渠道";
}

async function submitJobSearch(form) {
  if (context.busy) return notify("当前 Agent 正在运行，请稍后再试", "error");
  const bootstrap = currentProjectBootstrapStatus();
  if (bootstrap.state !== "ready" || !context.cwd) {
    renderDiscoveryPreflight();
    return notify(
      projectContext.snapshotUnreadable
        ? "请先修复或备份无法读取的 job-hunt-panel.json"
        : "请先建立求职数据源，再逐个验证渠道",
      "error",
    );
  }
  const data = new FormData(form);
  const requestedProviderIds = data
    .getAll("providers")
    .map((value) => String(value))
    .filter((id) => providerById(id));
  if (!requestedProviderIds.length) return notify("至少选择一个招聘渠道", "error");
  const verification = channelVerificationSummary(requestedProviderIds);
  if (!verification.allReady) {
    const pending = verification.pending
      .map((record) => providerById(record.providerId)?.label || record.providerId)
      .join("、");
    renderDiscoveryPreflight();
    return notify(`请先逐个验证：${pending}`, "error");
  }
  const preferences = currentDiscoveryPreferences({
    keyword: data.get("keyword"),
    location: data.get("location"),
    seniority: data.get("seniority"),
    count: data.get("count"),
    freshnessDays: data.get("freshnessDays"),
    workMode: data.get("workMode"),
    exclusions: data.get("exclusions"),
    providers: requestedProviderIds,
    lastRunAt: new Date().toISOString(),
  });
  const {
    keyword,
    location,
    seniority,
    count,
    freshnessDays,
    workMode,
    exclusions,
  } = preferences;
  const providerIds = preferences.providers;
  const providers = providerIds.map((id) => providerById(id)).filter(Boolean);
  const providerSummary = providers
    .map((provider) => `${provider.label}（${provider.domain}）`)
    .join("、");
  state.discoveryPreferences = preferences;
  persist();
  const preferencesSaved = await writeProjectSnapshot();
  renderMaterials();
  if (!preferencesSaved) {
    return notify("搜索条件无法写入当前项目；请先恢复项目写入权限再重试", "error");
  }
  const freshnessLabel = freshnessDays ? `最近 ${freshnessDays} 天` : "发布时间不限";
  const workModeLabel = WORK_MODE_LABELS[workMode] || WORK_MODE_LABELS.any;
  const prompt = [
    "请使用 job-hunt-hq:job-hunt-workflow 与 job-hunt-hq:job-intelligence Skills，在当前 Session 里完成一次完整岗位发现。",
    `目标是从 ${providerSummary} 收集最多 ${count} 个可直接阅读和筛选的完整 JD。这个数量只统计正式岗位，不统计搜索结果卡片或部分描述。`,
    `条件：关键词「${keyword || "从项目资料和面板推断"}」，地点「${location || "不限"}」，经验「${seniority}」，时效「${freshnessLabel}」，工作方式「${workModeLabel}」。`,
    exclusions ? `明确排除：${exclusions}` : "排除条件：无额外限制。",
    "面板已在发送前确认当前求职项目已初始化，且所有勾选渠道都已逐个在当前 Session 验证；仍要先调用 get_job_search_context 复核项目绑定、搜索条件与 channelVerifications。",
    "本次直接搜索已验证渠道。如果实际访问状态发生变化，立即调用 save_channel_verification 写回该渠道的新状态，并停止搜索该渠道；不要把它记为已搜索。",
    "不要读取、导出或复制 Cookie，不要使用 shell、curl 或浏览器外 HTTP 客户端重放已登录请求。公司官网和其他无需登录的渠道可以继续处理。",
    "按勾选渠道逐一搜索。先从列表页建立候选，再打开详情页核验当前有效性并完整读取岗位职责和任职要求；优先公司官网、原始 ATS 或原始发布页。不要因为一个渠道受限而放弃其他已验证渠道。",
    "调用 save_job_opportunities 分批写回。面板会把 listing_only 或 partial 自动放入“待补全线索”，只有明确标为 full、正文足够完整并同时包含职责与任职要求的记录才进入正式岗位池，并写入 career-data/jd/jobs/。不要把线索计入目标数量，也不要用相似岗位内容补齐当前 JD。",
    `如果第一批列表不足以形成 ${count} 个完整 JD，应继续打开更多相关候选详情页，直到达到目标、合格结果耗尽或渠道受限；同一 URL 重复调用会补全并晋级原线索。`,
    "尽量保留 canonical URL、source、published_at、fetched_at 和 verification_notes。新正式岗位仍只进入待筛选状态，不代表用户感兴趣或准备投递。",
    "每个受限渠道用一个 warning Trace 事件说明原因；成功渠道用一个 source 事件汇总真实页面，不报告日常点击步骤。最终 Trace 摘要要分别说明正式岗位数、待补全线索数、渠道覆盖和访问限制。",
    "只做岗位发现，不自动扩展到公司调研、简历或面试题。不要编造，也不要导出或在浏览器外复用招聘网站的登录凭据。",
  ].join("\n");

  const sent = await submitSessionTask(prompt, "已交给 Agent，找到的职位会写回机会面板", {
    instruction: `从 ${providerSummary} 搜索最多 ${count} 个「${keyword || "目标方向"}」岗位。`,
    target: {
      kind: "discovery",
      title: `岗位发现 · ${keyword || "目标方向"}`,
      detail: `${providerSummary} · ${location || "地点不限"} · ${freshnessLabel}`,
      payload: {
        providers: providerIds,
        keyword,
        location,
        seniority,
        count,
        freshnessDays,
        workMode,
        exclusions,
        preferencesSaved,
      },
    },
  });
  if (sent) closeDialog("agent-dialog");
}

async function submitResumeRevision(request) {
  const job = activeResumeJob();
  const metadata =
    state.resume.kind === "variant"
      ? [
          '保持 resume_kind="variant"。',
          `job_id="${state.resume.jobId}"。`,
          `base_resume_id="${state.resume.baseResumeId}"。`,
          `category="${state.resume.category}"。`,
        ].join(" ")
      : [
          '保持 resume_kind="base"，不要绑定当前 JD。',
          `category="${state.resume.category || requestedBaseCategory()}"。`,
        ].join(" ");
  const prompt = [
    "请同时使用 job-hunt-hq:job-hunt-workflow、job-hunt-hq:resume-writing 与 job-hunt-hq:resume-design skills，并用 panel-app:job-hunt-hq 工具调整当前简历。",
    job ? `当前是岗位定制版，目标职位 ID：${job.id}` : "当前是方向级 Base Resume。",
    metadata,
    "先调用 get_job_search_context；项目中有 CODESHELL.md 时按它读取相关资料，再核对当前简历与项目证据。",
    "若识别到新的候选人资料，先调用 save_candidate_context 更新面板。只使用能核实的真实信息，不要编造公司、日期、技术、职责或数据。",
    "完成后必须调用 save_resume_draft，使用上面的简历层级字段并把完整 Markdown 写回面板。",
    RESUME_EVIDENCE_PROTOCOL,
    `我的调整要求：${request}`,
  ].join("\n");
  const sent = await submitSessionTask(prompt, "Agent 已开始调整，完成后新草稿会写回这里", {
    instruction: request,
    target: {
      kind: "resume",
      title: state.resume.title || "当前简历",
      detail: state.resume.kind === "base" ? "Base Resume" : "JD Variant",
      payload: {
        resumeVersionId: resumeRecordId(state.resume),
        jobId: state.resume.jobId || "",
      },
    },
  });
  if (sent) closeDialog("resume-agent-dialog");
}

function readPhotoFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
    reader.addEventListener("error", () => reject(new Error("读取照片失败")), { once: true });
    reader.readAsDataURL(file);
  });
}

function loadPhotoImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("无法解析这张照片")), { once: true });
    image.src = source;
  });
}

async function prepareResumePhoto(file) {
  if (!file || !/^image\/(?:png|jpeg|webp)$/i.test(file.type)) {
    throw new Error("请选择 PNG、JPEG 或 WebP 照片");
  }
  if (file.size > 8 * 1024 * 1024) throw new Error("原始照片不能超过 8MB");
  const source = await readPhotoFile(file);
  const image = await loadPhotoImage(source);
  const targetWidth = 240;
  const targetHeight = 320;
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = targetWidth / targetHeight;
  const cropWidth =
    sourceRatio > targetRatio ? image.naturalHeight * targetRatio : image.naturalWidth;
  const cropHeight =
    sourceRatio > targetRatio ? image.naturalHeight : image.naturalWidth / targetRatio;
  const cropX = (image.naturalWidth - cropWidth) / 2;
  const cropY = (image.naturalHeight - cropHeight) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const drawing = canvas.getContext("2d", { alpha: false });
  if (!drawing) throw new Error("当前环境无法处理照片");
  drawing.fillStyle = "#ffffff";
  drawing.fillRect(0, 0, targetWidth, targetHeight);
  drawing.drawImage(
    image,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    targetWidth,
    targetHeight,
  );
  let output = canvas.toDataURL("image/jpeg", 0.74);
  if (output.length > 90000) output = canvas.toDataURL("image/jpeg", 0.6);
  if (!isSupportedResumePhoto(output) || output.length > 90000) {
    throw new Error("压缩后的照片仍然过大，请换一张尺寸更小的图片");
  }
  return output;
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
  if (!isWorkflowEligibleStage(job.status)) {
    return notify("这个 JD 还在待筛选；先标记感兴趣，再生成面试题", "error");
  }
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
      sourceMode: "jd",
      title: `${job.company} · ${INTERVIEW_MODE_LABELS[options.mode] || "定制面试"}`,
      mode: options.mode,
      difficulty: options.difficulty,
      createdAt: new Date().toISOString(),
      questions: buildInterviewQuestions(job, options),
    };
    state.interviewSets = [set, ...state.interviewSets].slice(0, 20);
    recordTraceArtifact("question-set", set.id, `${set.title} · ${set.questions.length} 题`);
    state.selectedInterviewSetId = set.id;
    state.interviewCategoryFilter = "全部";
    state.activeView = "interviews";
    persist();
    renderAll();
    void writeProjectSnapshot().then(() => renderMaterials());
    notify("已生成可编辑预览题单；安装到 CodeShell 后，Agent 会进一步按材料深挖");
    return;
  }

  const prompt = [
    "请使用 job-hunt-hq:job-hunt-workflow、job-hunt-hq:interview-coach skills 和 panel-app:job-hunt-hq 工具生成岗位定制面试题。",
    `目标职位 ID：${job.id}`,
    `题单模式：${options.mode}（${INTERVIEW_MODE_LABELS[options.mode] || "综合面试"}）`,
    `难度：${options.difficulty}；数量：${options.count}；回答语言：${options.language}。`,
    options.focus ? `特别关注：${options.focus}` : "特别关注：根据 JD 与候选人证据自动判断。",
    "先调用 get_job_search_context；项目中有 CODESHELL.md 时按它读取相关资料，再交叉核对 JD、工作经历、代码项目和当前简历。",
    "若识别到新的候选人资料，先调用 save_candidate_context 更新面板。",
    "每道题都要说明为什么问、关联哪些真实证据、回答要点和可能追问；同时覆盖最明显的材料缺口。不要编造项目、技术、职责或数字。",
    "完成后必须调用 save_interview_question_set，传 source_mode=jd 写回面板。每道题至少提供一个 evidence_refs。",
  ].join("\n");
  return submitSessionTask(prompt, "Agent 正在读取当前项目并生成面试题，完成后会自动显示", {
    instruction: `为 ${job.company} · ${job.title} 生成 ${options.count} 道岗位面试题。`,
    target: {
      kind: "interview",
      title: `${job.company} · ${job.title} 题库`,
      detail: `${INTERVIEW_MODE_LABELS[options.mode] || "综合面试"} · ${options.difficulty}`,
      payload: { jobId: job.id, sourceMode: "jd" },
    },
  });
}

async function generateCommitInterviewSet() {
  if (!window.codeshellPanel?.call) {
    return notify("安装到 CodeShell 后，Agent 才能读取当前项目的 Git 提交记录");
  }
  const prompt = [
    "请使用 job-hunt-hq:job-hunt-workflow、job-hunt-hq:interview-coach skills 和 panel-app:job-hunt-hq 工具，从当前项目的真实 Commit 生成项目深挖面试题。",
    "先调用 get_job_search_context；项目中有 CODESHELL.md 时按它定位候选人实际参与的 Repo。",
    "用只读 Git 命令查看提交历史。先筛选有实质改动且能归因给候选人的 Commit，再按需查看 git show、变更文件和测试；不要把合并、格式化或他人提交当成候选人能力。",
    "围绕问题背景、方案选择、关键 diff、失败尝试、测试验证、兼容与回滚设计问题和追问。无法确认作者或上下文时明确标为证据缺口。",
    "完成后调用 save_interview_question_set，传 source_mode=commits，省略 job_id。每道题至少有一个 evidence_refs，格式为 commit:<完整或短 SHA> · <subject> · <关键路径>。",
  ].join("\n");
  return submitSessionTask(prompt, "Commit 深挖题已发送到当前 Session；完成后会写回题库", {
    instruction: "从当前项目的真实 Git Commit 生成项目深挖面试题。",
    target: {
      kind: "interview",
      title: "当前项目 · Commit 深挖",
      detail: "读取实质 Commit 与关键 diff",
      payload: { sourceMode: "commits" },
    },
  });
}

async function simulateInterviewSession() {
  const set = selectedInterviewSet();
  const job = set ? state.jobs.find((item) => item.id === set.jobId) : null;
  if (!set) return notify("先选择一套面试题", "error");
  if (!window.codeshellPanel?.call) {
    return notify("安装到 CodeShell 后可开始一题一题的模拟面试");
  }
  const prompt = [
    "请使用 job-hunt-hq:job-hunt-workflow、job-hunt-hq:interview-coach skills 和 panel-app:job-hunt-hq 工具，开始一场互动模拟面试。",
    job
      ? `目标职位 ID：${job.id}；面试题单 ID：${set.id}；题单标题：${set.title}。`
      : `这是 Commit 深挖题单；面试题单 ID：${set.id}；题单标题：${set.title}。`,
    "先调用 get_job_search_context 读取完整题单；项目中有 CODESHELL.md 时再按它补充候选人上下文。每次只问一道题，在我回答前不要展示回答要点。",
    "收到回答后，从事实证据、结构清晰度、技术深度和岗位相关性四方面给简短反馈，再选择一个追问或进入下一题。",
    "若我的回答超出已有材料，提醒我核实，不要替我补造事实。全部结束后给出优势、风险和下一轮练习建议。",
  ].join("\n");
  return submitSessionTask(prompt, "模拟面试已开始，Agent 会从第一题逐步追问", {
    instruction: `从题单「${set.title}」开始逐题模拟面试。`,
    target: {
      kind: "interview",
      title: set.title,
      detail: job ? `${job.company} · ${job.title}` : "Commit 深挖题单",
      payload: { interviewSetId: set.id, jobId: set.jobId || "" },
    },
  });
}

async function submitSessionTask(prompt, successMessage, options = {}) {
  if (context.busy) {
    notify("当前 Session 的 Agent 正在执行，请稍后再试", "error");
    return false;
  }
  const traceId =
    options.traceId ||
    recordSessionSubmission(
      options.instruction || prompt.split(/\r?\n/).slice(0, 5).join(" "),
      options.target || currentSessionTarget(),
      options.parentTraceId || "",
    );
  activeSessionTraceId = traceId;
  const activity = state.sessionActivity.find((item) => item.id === traceId);
  if (!activity) {
    notify("无法关联这次执行记录，请重新发送", "error");
    activeSessionTraceId = "";
    return false;
  }
  activity.requestPrompt = String(prompt || "").slice(0, 30000);
  activity.updatedAt = new Date().toISOString();
  persist();
  const tracedPrompt = `${prompt}\nPanel Trace ID：${traceId}。调用每个非只读 Panel 工具时都传 trace_id="${traceId}"，使结构化写回严格属于这次执行。最后调用 complete_execution_trace，明确记录 completed、partial 或 failed、结果摘要和输出引用。`;
  try {
    const displayText = String(
      options.displayText || options.instruction || activity.instruction || prompt,
    )
      .trim()
      .slice(0, 20000);
    await hostCall("agent.submitPrompt", { prompt: tracedPrompt, displayText });
    if (window.codeshellPanel?.call) {
      updateSessionSubmission(traceId, context.busy ? "running" : "submitted", "Session 已接收任务");
    } else {
      updateSessionSubmission(traceId, "completed", "浏览器预览已完成模拟提交");
      activeSessionTraceId = "";
    }
    notify(
      window.codeshellPanel?.call
        ? successMessage
        : "浏览器预览不会启动 Agent；安装到 CodeShell 后会发送到当前 Session",
    );
    return true;
  } catch (error) {
    updateSessionSubmission(
      traceId,
      "failed",
      "任务提交失败",
      error instanceof Error ? error.message : "发送到当前 Session 失败",
    );
    activeSessionTraceId = "";
    notify(error instanceof Error ? error.message : "发送到当前 Session 失败", "error");
    return false;
  }
}

function rerunSessionTrace(activity) {
  if (!activity) return false;
  const prompt =
    activity.requestPrompt ||
    buildSessionBridgePrompt(activity.instruction, activity.target || currentSessionTarget());
  return submitSessionTask(prompt, "已按原始输入重新执行；新 Trace 会单独记录结果", {
    instruction: activity.instruction,
    target: activity.target,
    parentTraceId: activity.id,
  });
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
      `简历优化：先检查是否已有与目标大类匹配的 Base Resume。没有时先保存一份 resume_kind=base 的方向级基础简历；有岗位时再从指定 base_resume_id 分别派生 resume_kind=variant 的岗位版。${RESUME_EVIDENCE_PROTOCOL} 未选岗位时只生成或更新 Base Resume，省略 job_id。`,
    match:
      "JD 匹配：逐岗位拆解要求、已有证据、真实缺口与影响，并把结果合并进 save_preparation_plan。",
    intel:
      "公司与面经：逐岗位查官网、招聘页、可靠公开信息、评价和面试经验，区分 reported 与 predicted，并调用 save_job_research。",
    questions:
      "定制题库：逐岗位从 JD、Repo、工作经历和缺口生成问题、回答点与追问，并调用 save_interview_question_set。",
    commits:
      "Commit 深挖题：不要求选择岗位。读取当前项目相关 Repo 的真实 git log 与有代表性的 diff，从架构决策、问题定位、测试、回滚和取舍生成项目深挖题；调用 save_interview_question_set 时传 source_mode=commits，并让每道题的 evidence_refs 至少包含一个 commit:<sha> · <subject> · <path>。",
    prepare:
      "补强计划：把缺口严格分成 profile（资料待补）、evidence（证据待补）、skill（能力待学）；只针对 skill 缺口生成分阶段学习 roadmap，每阶段写明周期、任务、产出和完成标准。资料与证据缺口只生成补资料或补 Source 行动，不伪装成学习任务。整理优势、简历修改项和下一步后调用 save_preparation_plan；未选岗位时省略 job_id。",
    mock:
      "模拟面试：先完成其他已选结构化任务，再从一个已选岗位开始互动；每次只问一道题，收到回答后再反馈和追问。",
    debrief:
      "真实复盘：先简短询问我粘贴面试轮次、问题、回答、反馈与结果；收到后调用 save_interview_debrief，并据此更新补强计划。不要替我编造未提供的面试内容。",
  };
  const prompt = [
    "请使用 job-hunt-hq:job-hunt-workflow skill 和 panel-app:job-hunt-hq 工具，执行下面这组用户自由组合的任务。",
    "按本次任务加载最小专用 Skill 集：岗位发现/公司面经用 job-hunt-hq:job-intelligence；简历内容用 job-hunt-hq:resume-writing；简历视觉与导出用 job-hunt-hq:resume-design；题库、Commit 深挖、补强、模拟和复盘用 job-hunt-hq:interview-coach。未勾选的模块不要加载或执行。",
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
    {
      instruction: `执行：${tasks.map((id) => WORKFLOW_TASKS[id].label).join("、")}`,
      target: {
        kind: "workflow",
        title: "组合求职任务",
        detail: `${jobs.length} 个岗位 · ${tasks.length} 个任务`,
        payload: { jobIds: jobs.map((job) => job.id), taskIds: tasks },
      },
    },
  );
}

function runCompanyResearchInSession() {
  const job = selectedJob();
  if (!job) return notify("先选择一个职位", "error");
  if (!isWorkflowEligibleStage(job.status)) {
    return notify("这个 JD 还在待筛选；先标记感兴趣，再做公司与面经调研", "error");
  }
  return submitSessionTask(
    [
      "请使用 job-hunt-hq:job-hunt-workflow 与 job-hunt-hq:job-intelligence skills，继续调研当前求职面板里选中的岗位。",
      `目标职位 ID：${job.id}；公司：${job.company}；岗位：${job.title}。`,
      "先调用 panel-app:job-hunt-hq 的 get_job_search_context 取得完整 JD，再查公司官网、招聘官网、产品与可靠公开信息。",
      "汇总公开员工或候选人评价与面试情报，严格区分事实、主观观点、公开报道的问题和根据 JD 推测的问题。",
      "保存来源、时间、置信度与核验缺口，并通过 save_job_research 写回面板。",
    ].join("\n"),
    "公司调研已发送到当前 Session；结果会写回调研页",
    {
      instruction: `调研 ${job.company} 的官网、公开评价与面试情报。`,
      target: {
        kind: "research",
        title: `${job.company} · 公司与面经`,
        detail: job.title,
        payload: { jobId: job.id },
      },
    },
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

function normalizeIncomingOpportunity(job, index, label = "jobs") {
  assertPlainObject(job, `${label}[${index}]`);
  if (
    typeof job.company !== "string" ||
    !job.company.trim() ||
    typeof job.title !== "string" ||
    !job.title.trim()
  ) {
    throw new Error(`${label}[${index}] 缺少 company 或 title`);
  }
  const url = normalizeJobUrl(job.url);
  const sourceId = normalizeSourceId(job.source_id ?? job.sourceId, job.source);
  const description = cleanText(job.description, 20000);
  const jdCompleteness = normalizeJdCompleteness(
    job.jd_completeness ?? job.jdCompleteness,
    description,
  );
  const now = new Date().toISOString();
  return normalizeJobApplication({
    id: cleanText(job.id, 100) || uid("agent-job"),
    company: job.company.trim().slice(0, 80),
    title: job.title.trim().slice(0, 120),
    location: cleanText(job.location, 80),
    salary: cleanText(job.salary, 80),
    source: cleanText(job.source, 40) || "Agent 搜索",
    sourceId,
    url,
    publishedAt: cleanText(job.published_at ?? job.publishedAt, 80),
    employmentType: cleanText(job.employment_type ?? job.employmentType, 80),
    description,
    jdCompleteness,
    verificationNotes: cleanText(
      job.verification_notes ?? job.verificationNotes,
      2000,
    ),
    fetchedAt: cleanText(job.fetched_at ?? job.fetchedAt, 80) || now,
    match: Number.isInteger(job.match) ? Math.min(100, Math.max(0, job.match)) : null,
    status: "inbox",
    createdAt: cleanText(job.created_at ?? job.createdAt, 80) || now,
    updatedAt: now,
    sample: false,
  });
}

function registerAgentTools(ready) {
  const registerTool = window.codeshellPanel?.registerTool;
  if (!registerTool) return;
  const register = (name, handler) =>
    registerTool(name, async (args) => {
      activateTraceFromToolArgs(args);
      recordActiveTraceEvent("running", `调用 Panel 工具：${name}`);
      try {
        return await handler(args);
      } catch (error) {
        recordActiveTraceEvent(
          "failed",
          `Panel 工具失败：${name}`,
          error instanceof Error ? error.message : "工具调用失败",
        );
        throw error;
      }
    });

  register("get_job_search_context", async (args = {}) => {
    await ready;
    assertPlainObject(args, "get_job_search_context");
    if (Object.keys(args).length) throw new Error("get_job_search_context 不接受参数");
    recordActiveTraceEvent(
      "running",
      "读取 Panel 项目上下文",
      `${state.jobs.length} 个岗位 · ${state.repos.length} 个 Repo · ${resumeRecords().length} 份简历 · ${state.interviewSets.length} 套题库`,
    );
    return {
      project: clone(projectContext),
      sessionId: context.sessionId || null,
      projectStatePath: PROJECT_STATE_PATH,
      activeTraceId: activeTrace()?.id || null,
      selectedJobId: state.selectedJobId,
      selectedJob: clone(selectedJob()),
      selectedBaseResumeId: state.selectedBaseResumeId,
      baseResumes: clone(baseResumes()),
      opportunities: clone(state.jobs),
      jobLeads: clone(state.jobLeads),
      jdInboxPath: JD_INBOX_PATH,
      jdIntakeItems: clone(state.jdIntakeItems),
      profile: clone(state.profile),
      repositories: clone(state.repos),
      workHistory: clone(state.experiences),
      jobResearch: clone(state.jobResearch),
      workflowRuns: clone(state.workflowRuns),
      resume: clone(state.resume),
      resumeVersions: clone(resumeRecords()),
      interviewSets: clone(state.interviewSets),
      preparationPlans: clone(state.preparationPlans),
      interviewDebriefs: clone(state.interviewDebriefs),
      workflowSelection: {
        jobIds: clone(state.workflowJobIds),
        taskIds: clone(state.workflowTaskIds),
      },
      discoveryPreferences: clone(state.discoveryPreferences),
      channelVerifications: providerCatalog().map((provider) => channelVerification(provider.id)),
      providerCatalog: clone(providerCatalog()),
      evidencePolicy:
        "Read panel context first. Check the current project's CODESHELL.md once and follow it when present; its absence is not a blocker. Use only verifiable project evidence; never invent facts or metrics.",
      collectionPolicy:
        "Use public pages or the connected visible browser, preserve source attribution, and never bypass access controls. Never export cookies or replay authenticated recruiting-site requests outside the browser. Listing cards and partial descriptions are leads, not formal opportunities; only a complete JD with responsibilities and requirements is counted in opportunities.",
      applicationPolicy:
        "Update application progress only from an explicit user action or user-provided recruiting event. Resume generation and mock interviews are preparation, not proof of real application stages.",
    };
  });

  register("report_execution_trace", async (args = {}) => {
    await ready;
    assertPlainObject(args, "report_execution_trace");
    const eventTypes = ["source", "stage", "warning"];
    if (
      !eventTypes.includes(args.event_type) ||
      !cleanText(args.label, 160) ||
      !Array.isArray(args.source_refs)
    ) {
      throw new Error("event_type、label 和 source_refs 为必填");
    }
    const sourceRefs = cleanTextList(args.source_refs, 8, 500);
    const detail = [cleanText(args.detail, 1000), sourceRefs.join(" · ")]
      .filter(Boolean)
      .join("\n");
    recordActiveTraceEvent(args.event_type, cleanText(args.label, 160), detail);
    return {
      recorded: true,
      eventType: args.event_type,
      sourceCount: sourceRefs.length,
      traceId: activeTrace()?.id || null,
    };
  });

  register("complete_execution_trace", async (args = {}) => {
    await ready;
    assertPlainObject(args, "complete_execution_trace");
    const activity = state.sessionActivity.find((item) => item.id === activeSessionTraceId);
    const status = cleanText(args.status, 20);
    const summary = cleanText(args.summary, 2000);
    if (!activity || !["completed", "partial", "failed"].includes(status) || !summary) {
      throw new Error("trace_id、status 和 summary 必须指向当前有效 Trace");
    }
    const outputRefs = cleanTextList(args.output_refs, 12, 500);
    const error = cleanText(args.error, 2000);
    finalizeTrace(activity, {
      status,
      summary,
      outputRefs,
      error,
      label:
        status === "completed"
          ? "Agent 已提交最终结果"
          : status === "partial"
            ? "Agent 已提交部分结果"
            : "Agent 已报告执行失败",
      eventId: uid("event"),
      at: new Date().toISOString(),
    });
    persist();
    renderSessionActivity();
    return {
      recorded: true,
      traceId: activity.id,
      status: activity.status,
      artifactCount: activity.artifacts.length,
      outputRefCount: outputRefs.length,
    };
  });

  register("save_channel_verification", async (args = {}) => {
    await ready;
    assertPlainObject(args, "save_channel_verification");
    const providerId = cleanText(args.provider_id, 80);
    const status = cleanText(args.status, 40);
    const detail = cleanText(args.detail, 1000);
    const provider = providerById(providerId);
    if (!provider) throw new Error("provider_id 不属于面板支持的招聘渠道");
    if (
      !["ready", "login_required", "captcha_required", "blocked", "unavailable"].includes(
        status,
      )
    ) {
      throw new Error("status 必须是渠道验证结果之一");
    }
    if (!detail) throw new Error("detail 必须说明当前页面的可见状态");
    if (!context.sessionId) throw new Error("当前面板没有绑定 Session，不能保存渠道验证");

    const record = updateChannelVerification(providerId, status, detail);
    if (activeChannelVerificationProviderId === providerId) {
      activeChannelVerificationProviderId = "";
    }
    recordActiveTraceEvent(
      status === "ready" ? "source" : "warning",
      `${provider.label}：${CHANNEL_VERIFICATION_LABELS[status]}`,
      detail,
    );
    persist();
    renderMaterials();
    renderChannelVerifications();
    renderDiscoveryPreflight();
    renderDiscoveryAutomation();
    const projectSaved = await writeProjectSnapshot();
    requireProjectSnapshot(projectSaved);
    return {
      saved: true,
      providerId,
      status,
      checkedAt: record.checkedAt,
      sessionId: record.sessionId,
      projectSaved,
    };
  });

  register("save_jd_intake_results", async (args = {}) => {
    await ready;
    assertPlainObject(args, "save_jd_intake_results");
    if (!Array.isArray(args.results) || args.results.length < 1 || args.results.length > 20) {
      throw new Error("results 必须包含 1–20 个 JD 来源结果");
    }
    const now = new Date().toISOString();
    const incoming = args.results.map((value, index) => {
      assertPlainObject(value, `results[${index}]`);
      const requestedId = cleanText(value.intake_id, 100);
      const existing = requestedId
        ? state.jdIntakeItems.find((item) => item.id === requestedId)
        : null;
      const sourcePath = cleanText(value.source_path, 1000) || existing?.sourcePath || "";
      const originalName =
        cleanText(value.original_name, 240) || existing?.originalName || sourcePath.split("/").at(-1);
      const sourceKind = cleanText(value.source_kind, 40) || existing?.sourceKind || "project_file";
      const status = cleanText(value.status, 40);
      const jobIds = cleanTextList(value.job_ids, 20, 100);
      if (!sourcePath || !originalName) {
        throw new Error(`results[${index}] 缺少 source_path 或 original_name`);
      }
      if (!JD_INTAKE_SOURCE_KIND_IDS.includes(sourceKind)) {
        throw new Error(`results[${index}] source_kind 无效`);
      }
      if (
        !JD_INTAKE_STATUS_IDS.includes(status) ||
        ["staged", "processing"].includes(status)
      ) {
        throw new Error(`results[${index}] status 无效`);
      }
      if (jobIds.some((jobId) => !state.jobs.some((job) => job.id === jobId))) {
        throw new Error(`results[${index}] 包含不存在的 job_id`);
      }
      if (status === "imported" && !jobIds.length) {
        throw new Error(`results[${index}] 标为 imported 时必须关联 job_ids`);
      }
      return {
        id: existing?.id || requestedId || uid("jd-intake"),
        sourceKind,
        originalName,
        sourcePath,
        status,
        summary: cleanText(value.summary, 2000),
        jobIds,
        receivedAt: existing?.receivedAt || now,
        updatedAt: now,
        error: cleanText(value.error, 2000),
      };
    });
    state.jdIntakeItems = upsertJdIntakeItems(state.jdIntakeItems, incoming);
    const completedIds = new Set(incoming.map((item) => item.id));
    activeJdIntakeIds = activeJdIntakeIds.filter((id) => !completedIds.has(id));
    for (const item of incoming) {
      recordTraceArtifact(
        "jd-intake",
        item.id,
        `${item.originalName} · ${JD_INTAKE_STATUS_LABELS[item.status]}`,
      );
    }
    persist();
    renderAll();
    const projectSaved = await writeProjectSnapshot();
    requireProjectSnapshot(projectSaved);
    return {
      saved: true,
      resultCount: incoming.length,
      importedCount: incoming.filter((item) => item.status === "imported").length,
      attentionCount: incoming.filter((item) => ["needs_review", "failed"].includes(item.status))
        .length,
      intakeIds: incoming.map((item) => item.id),
      projectSaved,
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
      photoDataUrl: state.profile.photoDataUrl || "",
      photoName: state.profile.photoName || "",
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
    recordTraceArtifact(
      "candidate-context",
      `candidate:${state.profile.name}`,
      `${state.profile.name} · ${state.repos.length} Repo · ${state.experiences.length} 段经历`,
    );
    persist();
    renderAll();
    const projectSaved = await writeProjectSnapshot();
    requireProjectSnapshot(projectSaved);
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
    const incoming = args.jobs.map((job, index) =>
      normalizeIncomingOpportunity(job, index),
    );
    const routed = upsertJobDiscovery(state.jobs, state.jobLeads, incoming, {
      dedupeKey: jobDedupeKey,
      metadataKey: jobMetadataKey,
    });
    const formalIncoming = incoming.filter((job) => assessJobOpportunity(job).isFormal);
    const formalJobs = formalIncoming
      .map((sourceJob) =>
        routed.jobs.find(
          (item) =>
            jobDedupeKey(item) === jobDedupeKey(sourceJob) ||
            jobMetadataKey(item) === jobMetadataKey(sourceJob),
        ),
      )
      .filter(Boolean);
    for (const job of formalJobs) {
      job.jdPath = formalJdPath(job);
      await upsertWorkspaceText(job.jdPath, `${formalJdMarkdown(job)}\n`);
    }
    state.jobs = routed.jobs.slice(0, 80);
    state.jobLeads = routed.leads.slice(0, 160);
    for (const sourceJob of incoming.slice(0, 8)) {
      const savedJob = state.jobs.find(
        (item) =>
          jobDedupeKey(item) === jobDedupeKey(sourceJob) ||
          jobMetadataKey(item) === jobMetadataKey(sourceJob),
      );
      if (savedJob) {
        recordTraceArtifact("job", savedJob.id, `${savedJob.company} · ${savedJob.title}`);
        continue;
      }
      const savedLead = state.jobLeads.find(
        (item) =>
          jobDedupeKey(item) === jobDedupeKey(sourceJob) ||
          jobMetadataKey(item) === jobMetadataKey(sourceJob),
      );
      if (savedLead) {
        recordTraceArtifact(
          "job-lead",
          savedLead.id,
          `${savedLead.company} · ${savedLead.title} · 待补全`,
        );
      }
    }
    if (routed.insertedJobs[0]) state.selectedJobId = routed.insertedJobs[0].id;
    const savedJobs = incoming
      .map((sourceJob) =>
        state.jobs.find(
          (item) =>
            jobDedupeKey(item) === jobDedupeKey(sourceJob) ||
            jobMetadataKey(item) === jobMetadataKey(sourceJob),
        ),
      )
      .filter(Boolean)
      .map((job) => ({
        id: job.id,
        company: job.company,
        title: job.title,
        jdPath: job.jdPath || "",
      }));
    const savedLeads = incoming
      .map((sourceJob) =>
        state.jobLeads.find(
          (item) =>
            jobDedupeKey(item) === jobDedupeKey(sourceJob) ||
            jobMetadataKey(item) === jobMetadataKey(sourceJob),
        ),
      )
      .filter(Boolean)
      .map((lead) => ({
        id: lead.id,
        company: lead.company,
        title: lead.title,
        missingFields: lead.missingFields,
      }));
    state.jobSourceFilter = "all";
    state.activeView = "dashboard";
    persist();
    renderAll();
    const projectSaved = await writeProjectSnapshot();
    requireProjectSnapshot(projectSaved);
    renderMaterials();
    return {
      inboxAdded: routed.insertedJobs.length,
      jobsUpdated: routed.updatedJobs,
      leadsAdded: routed.insertedLeads.length,
      leadsUpdated: routed.updatedLeads,
      promoted: routed.promoted.length,
      unchanged: routed.unchangedJobs + routed.unchangedLeads,
      selectedJobId: state.selectedJobId,
      totalJobs: state.jobs.length,
      totalLeads: state.jobLeads.length,
      savedJobs,
      savedLeads,
      projectSaved,
    };
  });

  register("update_application_progress", async (args = {}) => {
    await ready;
    assertPlainObject(args, "update_application_progress");
    const jobId = cleanText(args.job_id, 100);
    const status = cleanText(args.status, 30);
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job || !APPLICATION_STAGE_IDS.includes(status)) {
      throw new Error("job_id 和有效 status 为必填");
    }
    const patch = {
      status,
      note: cleanText(args.note, 2000),
      occurredAt: cleanText(args.occurred_at, 80),
    };
    if (Object.hasOwn(args, "next_action")) {
      patch.nextAction = cleanText(args.next_action, 500);
    }
    if (Object.hasOwn(args, "next_action_at")) {
      patch.nextActionAt = cleanText(args.next_action_at, 80);
    }
    const result = updateApplicationProgress(job, patch, {
      eventId: uid("application"),
      source: "agent",
      now: new Date().toISOString(),
    });
    if (result.changed) Object.assign(job, result.job);
    if (job.id === state.selectedJobId && !applicationStatusMatchesFilter(job.status, state.statusFilter)) {
      state.statusFilter = "all";
    }
    recordTraceArtifact(
      "job",
      job.id,
      `${job.company} · ${job.title} · ${APPLICATION_STAGE_LABELS[job.status]}`,
    );
    persist();
    renderAll();
    const projectSaved = await writeProjectSnapshot();
    requireProjectSnapshot(projectSaved);
    renderMaterials();
    return {
      updated: result.changed,
      jobId: job.id,
      status: job.status,
      statusLabel: APPLICATION_STAGE_LABELS[job.status],
      nextAction: job.application.nextAction,
      nextActionAt: job.application.nextActionAt,
      historyCount: job.application.history.length,
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
    recordTraceArtifact("workflow", run.id, `${run.currentStep} · ${run.status}`);
    persist();
    renderAll();
    const projectSaved = await writeProjectSnapshot();
    requireProjectSnapshot(projectSaved);
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
    recordTraceArtifact(
      "research",
      report.id,
      `${report.company?.officialName || job.company} · ${sources.length} 个 Source`,
    );
    persist();
    renderAll();
    const projectSaved = await writeProjectSnapshot();
    requireProjectSnapshot(projectSaved);
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
    const sourceMode = ["jd", "commits", "mixed"].includes(args.source_mode)
      ? args.source_mode
      : args.job_id
        ? "jd"
        : "commits";
    const requestedJobId = cleanText(args.job_id, 80);
    const job = requestedJobId
      ? state.jobs.find((item) => item.id === requestedJobId)
      : null;
    if (requestedJobId && !job) throw new Error("job_id 不存在，请先读取面板上下文");
    if (sourceMode !== "commits" && !job) {
      throw new Error("JD 或混合题库必须提供有效 job_id；纯 Commit 题库应使用 source_mode=commits");
    }
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
      const evidenceRefs = normalizeList(question.evidence_refs, 8, 160);
      if (!evidenceRefs.length) {
        throw new Error(`questions[${index}] 至少需要一个 evidence_refs`);
      }
      if (sourceMode === "commits" && !evidenceRefs.some((ref) => /^commit:[0-9a-f]{7,40}\b/i.test(ref))) {
        throw new Error(`questions[${index}] 的 Commit 深挖题必须引用 commit:<sha>`);
      }
      return {
        id: uid("agent-question"),
        category: question.category.trim().slice(0, 40),
        difficulty: question.difficulty,
        question: question.question.trim().slice(0, 600),
        why: question.why.trim().slice(0, 600),
        evidenceRefs,
        answerPoints: normalizeList(question.answer_points, 8, 300),
        followUps: normalizeList(question.follow_ups, 5, 500),
      };
    });
    const set = {
      id: uid("agent-interview"),
      jobId: job?.id || "",
      sourceMode,
      title: args.title.trim().slice(0, 120),
      mode: args.mode,
      difficulty: questions.some((question) => question.difficulty === "挑战")
        ? "挑战"
        : questions[0]?.difficulty || "进阶",
      createdAt: new Date().toISOString(),
      questions,
    };
    state.interviewSets = [set, ...state.interviewSets].slice(0, 20);
    recordTraceArtifact("question-set", set.id, `${set.title} · ${questions.length} 题`);
    if (job) state.selectedJobId = job.id;
    state.selectedInterviewSetId = set.id;
    state.interviewCategoryFilter = "全部";
    state.activeView = "interviews";
    persist();
    renderAll();
    const projectSaved = await writeProjectSnapshot();
    requireProjectSnapshot(projectSaved);
    renderMaterials();
    return {
      saved: true,
      jobId: job?.id || null,
      sourceMode,
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
      !Array.isArray(args.roadmap) ||
      !Array.isArray(args.resume_changes) ||
      !Array.isArray(args.next_actions)
    ) {
      throw new Error(
        "title、summary、strengths、gaps、roadmap、resume_changes 和 next_actions 为必填",
      );
    }
    const priorities = ["high", "medium", "low"];
    const actionKinds = ["resume", "evidence", "study", "practice", "research"];
    const gaps = args.gaps.slice(0, 30).map((gap, index) => {
      assertPlainObject(gap, `gaps[${index}]`);
      if (
        !cleanText(gap.area, 120) ||
        !PREPARATION_GAP_KIND_IDS.includes(gap.kind) ||
        !priorities.includes(gap.priority) ||
        !Array.isArray(gap.actions)
      ) {
        throw new Error(`gaps[${index}] 缺少有效 area、kind、priority 或 actions`);
      }
      return {
        area: cleanText(gap.area, 120),
        kind: normalizePreparationGapKind(gap.kind, gap),
        evidence: cleanText(gap.evidence, 1000),
        impact: cleanText(gap.impact, 1000),
        priority: gap.priority,
        actions: cleanTextList(gap.actions, 8, 500),
        practice: cleanText(gap.practice, 1000),
      };
    });
    const roadmap = args.roadmap.slice(0, 12).map((milestone, index) => {
      assertPlainObject(milestone, `roadmap[${index}]`);
      if (
        !cleanText(milestone.phase, 80) ||
        !cleanText(milestone.title, 160) ||
        !ROADMAP_KIND_IDS.includes(milestone.kind) ||
        !cleanText(milestone.duration, 80) ||
        !Array.isArray(milestone.tasks) ||
        !cleanText(milestone.deliverable, 1000) ||
        !Array.isArray(milestone.success_criteria) ||
        !ROADMAP_STATUS_IDS.includes(milestone.status || "planned")
      ) {
        throw new Error(
          `roadmap[${index}] 缺少有效 phase、title、kind、duration、tasks、deliverable、success_criteria 或 status`,
        );
      }
      return {
        phase: cleanText(milestone.phase, 80),
        title: cleanText(milestone.title, 160),
        kind: milestone.kind,
        duration: cleanText(milestone.duration, 80),
        objective: cleanText(milestone.objective, 1000),
        tasks: cleanTextList(milestone.tasks, 8, 500),
        deliverable: cleanText(milestone.deliverable, 1000),
        successCriteria: cleanTextList(milestone.success_criteria, 8, 500),
        status: milestone.status || "planned",
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
      roadmap,
      updatedAt: new Date().toISOString(),
      sample: false,
    };
    state.preparationPlans = [
      plan,
      ...state.preparationPlans.filter((item) => (item.jobId || "") !== requestedJobId),
    ].slice(0, 80);
    recordTraceArtifact("preparation-plan", plan.id, plan.title);
    if (job) state.selectedJobId = job.id;
    if (!job) state.selectedJobId = "";
    state.activeView = "interviews";
    persist();
    renderAll();
    const projectSaved = await writeProjectSnapshot();
    requireProjectSnapshot(projectSaved);
    return {
      saved: true,
      jobId: requestedJobId || null,
      preparationPlanId: plan.id,
      gapCount: gaps.length,
      nextActionCount: nextActions.length,
      roadmapCount: roadmap.length,
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
    recordTraceArtifact("interview-debrief", debrief.id, debrief.round);
    if (job) state.selectedJobId = job.id;
    if (!job) state.selectedJobId = "";
    state.activeView = "interviews";
    persist();
    renderAll();
    const projectSaved = await writeProjectSnapshot();
    requireProjectSnapshot(projectSaved);
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
    const resumeKind =
      args.resume_kind === "base" || args.resume_kind === "variant"
        ? args.resume_kind
        : requestedJobId
          ? "variant"
          : "base";
    const job = requestedJobId
      ? state.jobs.find((item) => item.id === requestedJobId)
      : null;
    if (requestedJobId && !job) throw new Error("job_id 不存在，请先读取面板上下文");
    if (resumeKind === "base" && requestedJobId) {
      throw new Error("Base Resume 不能绑定 job_id");
    }
    if (resumeKind === "variant" && !job) {
      throw new Error("岗位定制版必须提供有效 job_id");
    }
    const category = normalizeResumeCategory(
      args.category,
      selectedBaseResume()?.category || state.profile.target || state.profile.role,
    );
    const requestedBaseResumeId = cleanText(args.base_resume_id, 100);
    const base = resumeKind === "variant"
      ? baseResumes().find((item) => resumeRecordId(item) === requestedBaseResumeId)
      : null;
    if (resumeKind === "variant" && !base) {
      throw new Error("请先保存 Base Resume，并传入有效 base_resume_id 后再生成岗位定制版");
    }
    if (
      typeof args.title !== "string" ||
      !args.title.trim() ||
      typeof args.markdown !== "string" ||
      args.markdown.trim().length < 80
    ) {
      throw new Error("title 和至少 80 字符的 markdown 为必填");
    }
    const markdown = args.markdown.trim().slice(0, 50000);
    const claimEvidence = normalizeClaimEvidence(args.claim_evidence);
    const evidenceCoverage = resumeEvidenceCoverage(markdown, claimEvidence);
    if (!claimEvidence.length) {
      throw new Error("claim_evidence 为必填；每条简历能力与成果都必须关联 Source");
    }
    if (!evidenceCoverage.total) {
      throw new Error("简历至少需要一条可映射的专业概述、能力或成果表述");
    }
    if (evidenceCoverage.missing.length) {
      throw new Error(
        `以下简历表述缺少逐字匹配的 Source：${evidenceCoverage.missing.slice(0, 3).join("；")}`,
      );
    }
    if (evidenceCoverage.missingDetails.length) {
      throw new Error(
        `以下简历表述缺少重点说明、证据内容或面试追问：${evidenceCoverage.missingDetails.slice(0, 3).join("；")}`,
      );
    }
    const minimumCoreClaims = Math.min(3, evidenceCoverage.total);
    if (evidenceCoverage.core < minimumCoreClaims) {
      throw new Error(`至少标记 ${minimumCoreClaims} 条 importance=core 的核心重点`);
    }
    if (evidenceCoverage.core > 6) {
      throw new Error("核心重点最多 6 条；请把其余要点标为 supporting，避免重点失焦");
    }
    if (state.resume.markdown) archiveCurrentResume();
    const now = new Date().toISOString();
    if (resumeKind === "variant") state.selectedJobId = requestedJobId;
    state.activeView = "dashboard";
    if (job) job.status = "tailoring";
    const versionId = uid("resume");
    state.resume = {
      kind: resumeKind,
      category: resumeKind === "variant" ? base.category : category,
      baseResumeId: resumeKind === "variant" ? resumeRecordId(base) : "",
      jobId: resumeKind === "variant" ? requestedJobId : "",
      versionId,
      title: args.title.trim().slice(0, 120),
      markdown,
      style: normalizeResumeStyle(state.resume.style),
      pdfExports: [],
      claimEvidence,
      notes: Array.isArray(args.notes)
        ? args.notes.map((note) => String(note).slice(0, 300)).slice(0, 12)
        : [],
      updatedAt: now,
    };
    recordTraceArtifact(
      "resume",
      versionId,
      `${state.resume.title} · Source ${evidenceCoverage.supported}/${evidenceCoverage.total}`,
    );
    state.selectedBaseResumeId =
      resumeKind === "base" ? versionId : resumeRecordId(base);
    resumeMode = "preview";
    persist();
    renderAll();
    const projectSaved = await writeProjectSnapshot();
    requireProjectSnapshot(projectSaved);
    renderMaterials();
    return {
      saved: true,
      resumeKind,
      category: state.resume.category,
      baseResumeId: state.resume.baseResumeId || null,
      jobId: requestedJobId || null,
      title: state.resume.title,
      updatedAt: now,
      characterCount: state.resume.markdown.length,
      evidenceCoverage: `${evidenceCoverage.supported}/${evidenceCoverage.total}`,
      completePointCount: evidenceCoverage.complete,
      corePointCount: evidenceCoverage.core,
      strongEvidenceCount: evidenceCoverage.strong,
      verifiedClaimCount: evidenceCoverage.verified,
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
    renderSessionInstructionPreview();
    elements.sessionInstruction.focus();
  });
  elements.sessionInstruction.addEventListener("input", renderSessionInstructionPreview);
  elements.sessionTraceFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-session-trace-filter]");
    if (!button) return;
    state.sessionTraceFilter = button.dataset.sessionTraceFilter;
    persist();
    renderSessionActivity();
  });
  elements.sessionActivityList.addEventListener("click", (event) => {
    const artifactButton = event.target.closest("[data-trace-artifact-id]");
    if (artifactButton) {
      openTraceArtifact(
        artifactButton.dataset.traceArtifactKind,
        artifactButton.dataset.traceArtifactId,
      );
      return;
    }
    const rerunButton = event.target.closest("[data-rerun-session-activity-id]");
    if (rerunButton) {
      const activity = state.sessionActivity.find(
        (item) => item.id === rerunButton.dataset.rerunSessionActivityId,
      );
      rerunSessionTrace(activity);
      return;
    }
    const feedbackButton = event.target.closest("[data-trace-feedback-id]");
    if (feedbackButton) {
      const activity = state.sessionActivity.find(
        (item) => item.id === feedbackButton.dataset.traceFeedbackId,
      );
      const value = feedbackButton.dataset.traceFeedbackValue;
      if (!activity || !Object.hasOwn(TRACE_FEEDBACK_LABELS, value)) return;
      activity.feedback = activity.feedback === value ? "" : value;
      appendTraceEvent(
        activity,
        "feedback",
        activity.feedback ? `用户评价：${TRACE_FEEDBACK_LABELS[activity.feedback]}` : "用户清除评价",
      );
      activity.updatedAt = new Date().toISOString();
      persist();
      renderSessionActivity();
      return;
    }
    const button = event.target.closest("[data-session-activity-id]");
    if (!button) return;
    const activity = state.sessionActivity.find(
      (item) => item.id === button.dataset.sessionActivityId,
    );
    if (!activity) return;
    openSessionBridge(activity.target, activity.instruction, activity.id);
  });
  elements.sendSessionInstruction.addEventListener("click", async () => {
    const instruction = elements.sessionInstruction.value.trim();
    if (!instruction) return notify("先写一句希望 Agent 做什么", "error");
    const submissionId = recordSessionSubmission(instruction);
    sessionSubmissionPending = true;
    renderSessionBridge();
    elements.sessionBridgeState.classList.add("busy");
    elements.sessionBridgeStateLabel.textContent = "正在提交，你写的内容已保留";
    try {
      const sent = await submitSessionTask(
        buildSessionBridgePrompt(instruction),
        "当前 Session 已完成这条指令；发送内容已保留在面板",
        { traceId: submissionId },
      );
      elements.sessionBridgeStateLabel.textContent = sent
        ? "任务已发送；可在执行轨迹查看状态"
        : "发送失败；可以从最近发送重新尝试";
    } finally {
      sessionSubmissionPending = false;
      elements.sessionBridgeState.classList.toggle("busy", Boolean(context.busy));
      elements.sendSessionInstruction.disabled = Boolean(context.busy);
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
      elements.jobList.scrollTop = 0;
      alignSelectedJobToCurrentFilter();
      persist();
      renderAll();
    });
  });

  document.querySelectorAll("[data-job-status-shortcut]").forEach((button) => {
    button.addEventListener("click", () => {
      state.statusFilter = button.dataset.jobStatusShortcut;
      state.activeView = "dashboard";
      elements.jobList.scrollTop = 0;
      alignSelectedJobToCurrentFilter();
      persist();
      renderAll();
    });
  });

  document.querySelectorAll("[data-career-flow-action]").forEach((button) => {
    button.addEventListener("click", () =>
      runDashboardAction(button.dataset.careerFlowAction),
    );
  });

  document.querySelectorAll("[data-job-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.jobFilter =
        state.jobFilter === button.dataset.jobFilter ? "all" : button.dataset.jobFilter;
      elements.jobList.scrollTop = 0;
      alignSelectedJobToCurrentFilter();
      persist();
      renderAll();
    });
  });

  elements.jobSourceFilter.addEventListener("change", () => {
    state.jobSourceFilter = elements.jobSourceFilter.value;
    elements.jobList.scrollTop = 0;
    alignSelectedJobToCurrentFilter();
    persist();
    renderAll();
  });

  elements.jobSearchQuery.addEventListener("input", () => {
    jobSearchQuery = elements.jobSearchQuery.value;
    elements.jobList.scrollTop = 0;
    alignSelectedJobToCurrentFilter();
    renderJobs();
    renderResume();
    renderInsights();
  });

  elements.jobSort.addEventListener("change", () => {
    jobSort = elements.jobSort.value;
    elements.jobList.scrollTop = 0;
    renderJobs();
  });

  elements.jobList.addEventListener("click", (event) => {
    const triageButton = event.target.closest("[data-triage-job-id]");
    if (triageButton) {
      void triageJob(
        triageButton.dataset.triageJobId,
        triageButton.dataset.triageStatus,
      );
      return;
    }
    const traceButton = event.target.closest("[data-inspect-trace-id]");
    if (traceButton) {
      inspectSessionTrace(traceButton.dataset.inspectTraceId);
      return;
    }
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

  elements.jobLeadList.addEventListener("click", (event) => {
    const complete = event.target.closest("[data-complete-job-lead-id]");
    if (complete) {
      void completeJobLead(complete.dataset.completeJobLeadId);
      return;
    }
    const remove = event.target.closest("[data-remove-job-lead-id]");
    if (remove) void removeJobLead(remove.dataset.removeJobLeadId);
  });

  document
    .querySelector("#open-search")
    .addEventListener("click", () => {
      populateJobSearchForm();
      openDialog("agent-dialog");
    });
  elements.sourceChannelEntry.addEventListener("click", () => {
    showChannelVerificationPanel();
  });
  elements.showAddChannel.addEventListener("click", () => showAddChannelForm(true));
  elements.cancelAddChannel.addEventListener("click", () => showAddChannelForm(false));
  elements.addChannelForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void addCustomChannel(event.currentTarget);
  });
  elements.channelVerificationList.addEventListener("click", (event) => {
    const removeChannel = event.target.closest("[data-remove-provider-id]");
    if (removeChannel) {
      void removeCustomChannel(removeChannel.dataset.removeProviderId);
      return;
    }
    const restoreLogin = event.target.closest("[data-restore-provider-login-id]");
    if (restoreLogin) {
      void restoreProviderLogin(
        restoreLogin.dataset.restoreProviderLoginId,
        restoreLogin.dataset.credentialId,
      );
      return;
    }
    const login = event.target.closest("[data-login-provider-id]");
    if (login) {
      void loginAndSaveProvider(login.dataset.loginProviderId);
      return;
    }
    const button = event.target.closest("[data-verify-provider-id]");
    if (!button) return;
    void verifyProviderInSession(button.dataset.verifyProviderId);
  });
  elements.channelVerificationList.addEventListener("change", (event) => {
    const input = event.target.closest("[data-provider-enabled-id]");
    if (!input) return;
    void setProviderEnabled(input.dataset.providerEnabledId, input.checked);
  });
  elements.discoveryAutomationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveDiscoveryAutomation();
  });
  elements.toggleDiscoveryAutomation.addEventListener("click", () => {
    void controlDiscoveryAutomation("toggle");
  });
  elements.runDiscoveryAutomation.addEventListener("click", () => {
    void controlDiscoveryAutomation("run");
  });
  elements.deleteDiscoveryAutomation.addEventListener("click", () => {
    void controlDiscoveryAutomation("delete");
  });
  elements.intakeSearchSites.addEventListener("click", () => {
    populateJobSearchForm();
    openDialog("agent-dialog");
  });
  document.querySelector("#agent-search-form").addEventListener("change", (event) => {
    if (event.target.matches('input[name="providers"]')) renderDiscoveryPreflight();
  });
  elements.searchPreflightInitialize.addEventListener("click", () => {
    closeDialog("agent-dialog");
    state.activeView = "materials";
    persist();
    renderAll();
    requestAnimationFrame(() => elements.initializeJobHuntProject?.focus());
  });
  elements.searchVerifyChannels.addEventListener("click", showChannelVerificationPanel);
  elements.intakeImportMessage.addEventListener("click", openJdIntakeDialog);
  elements.intakeProjectFiles.addEventListener("click", () => {
    void scanProjectJdInbox();
  });
  elements.addJdIntake.addEventListener("click", openJdIntakeDialog);
  elements.scanJdInbox.addEventListener("click", () => {
    void scanProjectJdInbox();
  });
  elements.jdIntakeList.addEventListener("click", (event) => {
    const openJob = event.target.closest("[data-open-intake-job-id]");
    if (openJob) {
      const job = state.jobs.find((item) => item.id === openJob.dataset.openIntakeJobId);
      if (!job) return notify("关联岗位已经不在岗位池中", "error");
      state.selectedJobId = job.id;
      state.activeView = "dashboard";
      state.statusFilter = "all";
      persist();
      renderAll();
      return;
    }
    const process = event.target.closest("[data-process-intake-id]");
    if (process) void processJdIntakeItems([process.dataset.processIntakeId]);
  });
  document.querySelectorAll("[data-workflow-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      state.workflowTaskIds = [...(WORKFLOW_PRESETS[button.dataset.workflowPreset] || [])];
      persist();
      renderWorkflowBuilder();
      renderDashboardFocus(currentProjectBootstrapStatus());
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
    renderDashboardFocus(currentProjectBootstrapStatus());
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
    renderDashboardFocus(currentProjectBootstrapStatus());
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
  for (const id of ["open-job-form", "compact-add-job"]) {
    document.querySelector(`#${id}`).addEventListener("click", openJdIntakeDialog);
  }
  elements.emptyAddJob.addEventListener("click", () => {
    if (state.statusFilter === "inbox") return runDashboardAction("discover");
    if (state.statusFilter === "active") return runDashboardAction("inbox");
    return runDashboardAction("import");
  });
  document.querySelector("#sync-project-context").addEventListener("click", () => {
    if (projectContext.snapshotDirty) {
      return notify("当前有未同步修改，请先保存后再重新读取项目", "error");
    }
    void syncProjectContext({ quiet: false });
  });
  elements.initializeJobHuntProject.addEventListener("click", () => {
    void initializeJobHuntProject();
  });
  elements.resetJobHuntProject.addEventListener("click", () => openDialog("reset-dialog"));
  elements.confirmResetJobHunt.addEventListener("click", () => {
    void resetJobHuntWorkspace();
  });
  elements.dashboardInitializeProject.addEventListener("click", () =>
    runDashboardAction(
      elements.dashboardInitializeProject.dataset.dashboardAction,
      elements.dashboardInitializeProject.dataset.jobId,
    ),
  );
  elements.dashboardFocusSecondary.addEventListener("click", () =>
    runDashboardAction(elements.dashboardFocusSecondary.dataset.dashboardAction),
  );
  elements.saveProjectSnapshot.addEventListener("click", async () => {
    elements.saveProjectSnapshot.disabled = true;
    const saved = await writeProjectSnapshot();
    elements.saveProjectSnapshot.disabled = false;
    renderMaterials();
    notify(saved ? "未同步修改已写入当前项目" : "仍未能写入项目，请检查项目权限", saved ? "info" : "error");
  });
  document.querySelector("#open-interview-form").addEventListener("click", () => {
    if (!selectedJob()) return notify("先选择或添加一个职位", "error");
    openDialog("interview-dialog");
  });
  elements.generateCommitInterview.addEventListener("click", () => {
    void generateCommitInterviewSet();
  });
  elements.regenerateInterview.addEventListener("click", () => {
    const set = selectedInterviewSet();
    if (!set) return;
    if ((set.sourceMode || (set.jobId ? "jd" : "commits")) === "commits") {
      void generateCommitInterviewSet();
      return;
    }
    state.selectedJobId = set.jobId;
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
      normalizePreparationGapKind(gap.kind, gap) === "skill"
        ? "针对这个真实能力缺口，更新学习 Roadmap：给出最小学习范围、实战产出和可验证完成标准，不要只列课程名称。"
        : "针对这个资料或证据缺口，告诉我需要补充哪些真实材料或 Source；不要把它误判为需要学习的能力。",
    );
  });
  elements.preparationRoadmapList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-session-roadmap-index]");
    if (!button) return;
    const plan = selectedPreparationPlan();
    const roadmapIndex = Number(button.dataset.sessionRoadmapIndex);
    const milestone = plan?.roadmap?.[roadmapIndex];
    if (!plan || !milestone) return;
    openSessionBridge(
      {
        kind: "roadmap",
        title: milestone.title || milestone.phase || "学习 Roadmap",
        detail: milestone.objective || milestone.deliverable || "继续当前学习阶段",
        payload: {
          jobId: plan.jobId || "",
          preparationPlanId: plan.id,
          roadmapIndex,
        },
      },
      "继续这个 Roadmap 阶段：先核对当前完成情况，再给我下一项最小任务；有真实产出后更新阶段状态和补强计划。",
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
          jobId: set.jobId || "",
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

  elements.chooseJdFiles.addEventListener("click", () => elements.jdFileInput.click());
  elements.jdFileInput.addEventListener("change", () => {
    addPendingJdFiles(elements.jdFileInput.files);
    elements.jdFileInput.value = "";
  });
  elements.jdFileDropzone.addEventListener("click", (event) => {
    if (!event.target.closest("button")) elements.jdFileInput.click();
  });
  elements.jdFileDropzone.addEventListener("keydown", (event) => {
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      elements.jdFileInput.click();
    }
  });
  elements.jdFileDropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.jdFileDropzone.classList.add("dragging");
  });
  elements.jdFileDropzone.addEventListener("dragleave", () => {
    elements.jdFileDropzone.classList.remove("dragging");
  });
  elements.jdFileDropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.jdFileDropzone.classList.remove("dragging");
    addPendingJdFiles(event.dataTransfer?.files);
  });
  document.querySelector("#job-dialog").addEventListener("paste", (event) => {
    const files = event.clipboardData?.files;
    if (files?.length) {
      event.preventDefault();
      addPendingJdFiles(files);
      notify("已接收剪贴板截图");
    }
  });
  elements.jdFileSelection.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-jd-file-index]");
    if (!remove) return;
    pendingJdFiles.splice(Number(remove.dataset.removeJdFileIndex), 1);
    renderPendingJdFiles();
  });

  document.querySelector("#job-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void submitJdIntakeForm(event.currentTarget);
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
    state.resume.markdown = elements.resumeEditor.value;
    state.resume.updatedAt = new Date().toISOString();
    persist();
    scheduleProjectSnapshotSave();
  });

  elements.generateResume.addEventListener("click", () => void generateBaseDraft());
  elements.tailorResume.addEventListener("click", () => void generateVariantDraft());
  elements.baseResumeSelect.addEventListener("change", () => {
    const id = elements.baseResumeSelect.value;
    if (!id) return;
    state.selectedBaseResumeId = id;
    activateResumeVersion(id);
  });
  const updateResumeStyle = () => {
    state.resume.style = normalizeResumeStyle({
      template: elements.resumeTemplateSelect.value,
      density: elements.resumeDensitySelect.value,
    });
    persist({ quiet: false });
    renderResume();
    scheduleProjectSnapshotSave();
  };
  elements.resumeTemplateSelect.addEventListener("change", updateResumeStyle);
  elements.resumeDensitySelect.addEventListener("change", updateResumeStyle);
  elements.resumePhotoInput.addEventListener("change", async () => {
    const [file] = elements.resumePhotoInput.files || [];
    if (!file) return;
    try {
      state.profile.photoDataUrl = await prepareResumePhoto(file);
      state.profile.photoName = file.name.slice(0, 160);
      persist({ quiet: false });
      renderResume();
      renderMaterials();
      void writeProjectSnapshot();
      notify("照片已裁剪为 3:4 并应用到所有简历版本");
    } catch (error) {
      notify(error instanceof Error ? error.message : "照片处理失败", "error");
    } finally {
      elements.resumePhotoInput.value = "";
    }
  });
  elements.removeResumePhoto.addEventListener("click", () => {
    if (!state.profile.photoDataUrl) return;
    state.profile.photoDataUrl = "";
    state.profile.photoName = "";
    persist({ quiet: false });
    renderResume();
    renderMaterials();
    void writeProjectSnapshot();
    notify("简历照片已移除");
  });
  elements.saveResume.addEventListener("click", () => void saveResumeToRepo());
  elements.printResume.addEventListener("click", () => void exportResumeToPdf());
  elements.resumeTrace.addEventListener("click", () => {
    if (elements.resumeTrace.dataset.inspectTraceId) {
      inspectSessionTrace(elements.resumeTrace.dataset.inspectTraceId);
    }
  });
  elements.resumePreview.addEventListener("click", (event) => {
    const button = event.target.closest("[data-resume-claim-index]");
    if (!button) return;
    openResumePointSession(
      Number(button.dataset.resumeClaimIndex),
      button.dataset.resumeClaimAction,
    );
  });
  elements.continueResumeSession.addEventListener("click", () => {
    if (!state.resume.markdown) return notify("当前还没有可继续的简历", "error");
    openSessionBridge({
      kind: "resume",
      title: state.resume.title || "当前简历",
      detail:
        state.resume.kind === "base"
          ? `基础简历 · ${state.resume.category}`
          : activeResumeJob()
            ? `${activeResumeJob().company} · ${activeResumeJob().title}`
            : "岗位定制简历",
      payload: {
        jobId: state.resume.jobId || "",
        resumeVersionId: state.resume.versionId || "",
        resumeKind: state.resume.kind,
        category: state.resume.category,
        baseResumeId: state.resume.baseResumeId || "",
      },
    });
  });
  elements.resumeVersionList.addEventListener("click", (event) => {
    const openButton = event.target.closest("[data-open-resume-version-id]");
    if (openButton) {
      activateResumeVersion(openButton.dataset.openResumeVersionId);
      return;
    }
    const button = event.target.closest("[data-session-resume-version-id]");
    if (!button) return;
    const version = resumeRecords().find(
      (item) => resumeRecordId(item) === button.dataset.sessionResumeVersionId,
    );
    if (!version) return;
    const job = state.jobs.find((item) => item.id === version.jobId);
    openSessionBridge({
      kind: "resume",
      title: version.title || "简历版本",
      detail:
        version.kind === "base"
          ? `基础简历 · ${version.category}`
          : job
            ? `${job.company} · ${job.title}`
            : "岗位定制简历",
      payload: {
        jobId: version.jobId || "",
        resumeVersionId: version.versionId || version.id || "",
        resumeKind: version.kind,
        category: version.category,
        baseResumeId: version.baseResumeId || "",
      },
    });
  });
  elements.askAgent.addEventListener("click", () => openDialog("resume-agent-dialog"));
  elements.jobDetailInterest.addEventListener("click", () => {
    const job = selectedJob();
    if (job) void triageJob(job.id, "saved");
  });
  elements.jobDetailIgnore.addEventListener("click", () => {
    const job = selectedJob();
    if (job) void triageJob(job.id, "archived");
  });
  elements.deleteJob.addEventListener("click", () => openDeleteJobDialog(selectedJob()));
  elements.confirmDeleteJob.addEventListener("click", () => {
    void confirmDeleteJob();
  });
  elements.jobDetailTrace.addEventListener("click", () => {
    if (elements.jobDetailTrace.dataset.inspectTraceId) {
      inspectSessionTrace(elements.jobDetailTrace.dataset.inspectTraceId);
    }
  });
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
  elements.updateApplication.addEventListener("click", () => {
    const job = selectedJob();
    if (!job) return;
    const result = updateApplicationProgress(
      job,
      {
        status: elements.applicationStage.value,
        nextAction: elements.applicationNextAction.value,
        nextActionAt: elements.applicationNextActionAt.value,
        note: elements.applicationNote.value,
      },
      {
        eventId: uid("application"),
        source: "user",
        now: new Date().toISOString(),
      },
    );
    if (!result.changed) return notify("投递阶段和下一步没有变化");
    Object.assign(job, result.job);
    state.statusFilter = "all";
    persist();
    renderAll();
    void writeProjectSnapshot().then(() => renderMaterials());
    notify(`已更新为「${APPLICATION_STAGE_LABELS[job.status]}」并保存时间线`);
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
    await syncProjectContext({
      quiet: true,
      localStateSource: saved || compactPanelLocalState(state),
      allowLegacyMigration: Boolean(saved && saved.localStateVersion !== 2),
    });
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
