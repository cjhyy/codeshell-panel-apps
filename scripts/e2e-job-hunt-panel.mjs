/*
 * Real Electron smoke test for Job Hunt HQ's Panel-native write paths.
 *
 * This intentionally uses an isolated HOME, userData directory and project so
 * typed interview answers and private resume QA never touch developer data.
 */
/* global document, window */
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const panelSource = join(repositoryRoot, "apps", "job-hunt-hq");
const desktopDir = resolve(
  process.env.CODE_SHELL_DESKTOP_DIR || join(repositoryRoot, "packages", "desktop"),
);
const {
  assert,
  captureRendererErrors,
  findCodeShellWindow,
  launchCodeShellElectron,
  makeIsolatedElectronHome,
} = await import(pathToFileURL(join(desktopDir, "scripts", "electron-harness.mjs")).href);
const isolated = await makeIsolatedElectronHome("codeshell-job-hunt-e2e-");
const panelInstallDir = join(isolated.codeShellHome, "panel-apps", "job-hunt-hq");
const projectDir = join(isolated.home, "job-hunt-project");
const snapshotPath = join(projectDir, "job-hunt-panel.json");
const now = new Date().toISOString();
let app;

const bankQuestions = [
  {
    id: "bank-e2e-agent",
    fingerprint: "",
    fingerprintAliases: [],
    question: "请说明如何把 Agent 工具调用设计成可恢复、可审计且幂等的执行流程？",
    category: "Agent 架构",
    competency: "",
    type: "system_design",
    difficulty: "进阶",
    priority: "high",
    status: "inbox",
    origin: "manual",
    tags: ["Agent", "工具调用"],
    sourceRefs: ["user:e2e"],
    answerPoints: ["状态持久化", "幂等键", "人工审批"],
    recommendedAnswer: "从状态机、工具契约和失败恢复三个层面回答。",
    followUps: ["重复执行时如何避免副作用？"],
    notes: "",
    jobIds: [],
    interviewSetIds: ["set-e2e"],
    practiceAttempts: [],
    practiceReviews: [],
    lastPracticedAt: "",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "bank-e2e-rag",
    fingerprint: "",
    fingerprintAliases: [],
    question: "RAG 最终答案错误但召回文档相关时，你会按照什么顺序定位问题？",
    category: "RAG 调优",
    competency: "",
    type: "technical",
    difficulty: "进阶",
    priority: "medium",
    status: "inbox",
    origin: "manual",
    tags: ["RAG", "评估"],
    sourceRefs: ["user:e2e"],
    answerPoints: ["解析", "切分", "召回", "上下文组装", "生成"],
    recommendedAnswer: "先固定样本，再按链路逐段验证。",
    followUps: ["如何设计回归数据集？"],
    notes: "",
    jobIds: [],
    interviewSetIds: ["set-e2e"],
    practiceAttempts: [],
    practiceReviews: [],
    lastPracticedAt: "",
    createdAt: now,
    updatedAt: now,
  },
];

const snapshot = {
  schemaVersion: 2,
  updatedAt: now,
  selectedJobId: "",
  selectedInterviewSetId: "set-e2e",
  selectedBaseResumeId: "resume-e2e",
  profile: {
    name: "Candidate",
    role: "AI 应用工程师",
    contact: "candidate@example.com",
    target: "Agent 工程",
    summary: "测试候选人资料",
    photoDataUrl: "",
    photoName: "",
  },
  repos: [],
  experiences: [],
  jobs: [
    {
      id: "job-e2e",
      company: "Example AI",
      title: "AI-Augmented Developer",
      location: "Remote",
      salary: "",
      source: "E2E",
      sourceId: "other",
      url: "https://example.test/jobs/ai-developer",
      description: "Build reliable AI-assisted development and interview practice workflows.",
      jdCompleteness: "complete",
      status: "interested",
      addedAt: now,
      updatedAt: now,
    },
  ],
  jobLeads: [],
  jdIntakeItems: [],
  jobResearch: [],
  workflowRuns: [],
  preparationPlans: [],
  interviewDebriefs: [],
  channelVerifications: [],
  customProviders: [],
  discoveryRunReceipts: [],
  sessionActivity: [],
  resume: {
    id: "resume-e2e",
    versionId: "resume-e2e",
    parentVersionId: "",
    revisionReason: "",
    kind: "base",
    category: "Agent 工程",
    baseResumeId: "",
    jobId: "",
    style: { template: "editorial", density: "comfortable" },
    pdfExports: [
      {
        path: "career-data/resumes/e2e-agent-resume.pdf",
        exportedAt: now,
        size: 35,
      },
    ],
    title: "Agent 工程 Base Resume",
    markdown:
      "# Candidate\nAI 应用工程师 · candidate@example.com\n\n## 专业概述\n构建可恢复的 Agent 工作流。\n\n## 工作经历\n**2025年09月08日 - 至今｜上海**\n\n## 项目经历\n- 设计并实现面板原生模拟面试流程。",
    claimEvidence: [
      {
        claim: "设计并实现面板原生模拟面试流程。",
        status: "verified",
        importance: "core",
        whyItMatters: "体现端到端产品交付能力",
        sources: [
          {
            kind: "user",
            label: "E2E fixture",
            locator: "user:e2e",
            evidence: "隔离测试资料",
          },
        ],
        interviewQuestions: [{ question: "你如何保证回答可靠落盘？", focus: "可靠性" }],
        improvement: "",
      },
    ],
    candidateQuestions: [
      {
        id: "resume-qa-e2e",
        category: "impact",
        priority: "high",
        question: "这个流程上线后减少了哪些手工步骤？",
        why: "补充可核验结果",
        relatedClaim: "设计并实现面板原生模拟面试流程。",
        sourceHints: ["测试记录"],
        status: "open",
        answer: "",
        sourceRefs: [],
        suggestedChange: "",
        answeredAt: "",
      },
    ],
    variantChanges: [],
    notes: [],
    updatedAt: now,
  },
  versions: [
    {
      id: "resume-base-unused-e2e",
      versionId: "resume-base-unused-e2e",
      parentVersionId: "",
      revisionReason: "旧方向草稿",
      kind: "base",
      category: "Frontend",
      baseResumeId: "",
      jobId: "",
      style: { template: "editorial", density: "comfortable" },
      pdfExports: [],
      title: "Frontend · 旧 Base Resume",
      markdown: "# Candidate\nFrontend Engineer\n\n## 项目经历\n- 旧版方向草稿。",
      claimEvidence: [],
      candidateQuestions: [],
      variantChanges: [],
      notes: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "resume-variant-e2e",
      versionId: "resume-variant-e2e",
      parentVersionId: "",
      revisionReason: "",
      kind: "variant",
      category: "Agent 工程",
      baseResumeId: "resume-e2e",
      jobId: "job-e2e",
      style: { template: "editorial", density: "comfortable" },
      pdfExports: [],
      title: "Example AI · AI-Augmented Developer",
      markdown:
        "# Candidate\nAI 应用工程师 · candidate@example.com\n\n## 专业概述\n构建可恢复的 Agent 工作流。\n\n## 项目经历\n- 设计并实现可恢复的面板原生模拟面试流程。",
      claimEvidence: [
        {
          claim: "设计并实现可恢复的面板原生模拟面试流程。",
          status: "verified",
          importance: "core",
          whyItMatters: "更突出目标岗位关心的恢复性。",
          sources: [
            {
              kind: "user",
              label: "E2E fixture",
              locator: "user:e2e",
              evidence: "隔离测试资料",
            },
          ],
          interviewQuestions: [{ question: "你如何保证回答可靠落盘？", focus: "可靠性" }],
          improvement: "",
        },
      ],
      candidateQuestions: [],
      variantChanges: [
        {
          id: "resume-change-e2e",
          type: "rewrite",
          section: "项目经历",
          before: "设计并实现面板原生模拟面试流程。",
          after: "设计并实现可恢复的面板原生模拟面试流程。",
          beforeMarkdown: "- 设计并实现面板原生模拟面试流程。",
          afterMarkdown: "- 设计并实现可恢复的面板原生模拟面试流程。",
          reason: "更突出目标岗位关心的恢复性。",
          jobRequirementRefs: ["岗位职责 · 建设可恢复、可审计的 AI 工作流"],
          sourceRefs: ["user:e2e"],
          status: "pending",
          userEdited: false,
          updatedAt: "",
        },
      ],
      notes: [],
      updatedAt: now,
    },
  ],
  questionBank: bankQuestions,
  interviewSets: [
    {
      id: "set-e2e",
      jobId: "",
      jobIds: [],
      sourceMode: "commits",
      title: "E2E Agent 模拟面试",
      mode: "technical",
      difficulty: "进阶",
      createdAt: now,
      questions: bankQuestions.map((item, index) => ({
        id: `set-question-${index + 1}`,
        bankQuestionId: item.id,
        question: item.question,
        category: item.category,
        competency: item.competency,
        type: item.type,
        difficulty: item.difficulty,
        sourceRefs: item.sourceRefs,
        answerPoints: item.answerPoints,
        recommendedAnswer: item.recommendedAnswer,
        followUps: item.followUps,
        evidenceRefs: item.sourceRefs,
        why: "E2E 面板原生流程验证",
      })),
    },
  ],
  mockInterviewSessions: [],
};

function execute(view, source) {
  return view.evaluate((candidate, script) => candidate.executeJavaScript(script), source);
}

async function waitForGuest(view, predicate, message, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await execute(view, predicate).catch(() => false)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(message);
}

async function waitForSnapshot(predicate, message, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const current = JSON.parse(await readFile(snapshotPath, "utf8"));
    if (predicate(current)) return current;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(message);
}

try {
  await cp(panelSource, panelInstallDir, { recursive: true });
  await mkdir(join(isolated.codeShellHome, "panel-apps"), { recursive: true });
  await writeFile(
    join(isolated.codeShellHome, "panel-apps", "installed.json"),
    `${JSON.stringify({
      version: 1,
      apps: [
        {
          id: "job-hunt-hq",
          version: "4.1.1",
          source: panelSource,
          installedAt: now,
          lastUpdated: now,
        },
      ],
    })}\n`,
  );
  await mkdir(join(projectDir, ".code-shell"), { recursive: true });
  await writeFile(
    join(projectDir, ".code-shell", "settings.json"),
    `${JSON.stringify({ panelAppBindings: ["job-hunt-hq"] })}\n`,
  );
  await mkdir(join(isolated.codeShellHome, "desktop"), { recursive: true });
  await writeFile(
    join(isolated.codeShellHome, "desktop", "trust.json"),
    `${JSON.stringify({ [projectDir]: "trusted" })}\n`,
  );
  await writeFile(
    join(isolated.codeShellHome, "desktop", "recents.json"),
    `${JSON.stringify(
      [{ path: projectDir, name: "job-hunt-project", lastOpenedAt: Date.now() }],
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  await mkdir(join(projectDir, "career-data", "resumes"), { recursive: true });
  await writeFile(
    join(projectDir, "career-data", "resumes", "e2e-agent-resume.pdf"),
    "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n",
  );
  await writeFile(
    join(projectDir, "job-hunt-resume-base-resume-legacy.md"),
    snapshot.resume.markdown,
  );

  app = await launchCodeShellElectron({
    appDir: desktopDir,
    home: isolated.home,
    userDataDir: isolated.userDataDir,
  });
  const win = await findCodeShellWindow(app);
  const rendererErrors = captureRendererErrors(win);
  const panels = await win.evaluate(
    (cwd) => window.codeshell.listPanelApps(cwd, "zh-CN"),
    projectDir,
  );
  const panel = panels.find((item) => item.appId === "job-hunt-hq");
  assert(panel, "Job Hunt HQ was not listed for the bound project");
  assert(panel.version === "4.1.1", `expected Job Hunt HQ 4.1.1, got ${panel.version}`);
  const prepared = await win.evaluate(({ id, cwd }) => window.codeshell.preparePanelApp(id, cwd), {
    id: panel.id,
    cwd: projectDir,
  });
  await win.evaluate(({ src, partition }) => {
    const view = document.createElement("webview");
    view.id = "job-hunt-e2e";
    view.setAttribute("partition", partition);
    view.setAttribute("src", src);
    view.style.width = "1280px";
    view.style.height = "900px";
    document.body.appendChild(view);
  }, prepared);
  const view = win.locator("#job-hunt-e2e");
  await view.waitFor({ state: "attached" });
  await win.waitForFunction(() => {
    const candidate = document.getElementById("job-hunt-e2e");
    return typeof candidate?.getWebContentsId === "function" && candidate.getWebContentsId() > 0;
  });
  const guestId = await view.evaluate((candidate) => candidate.getWebContentsId());
  await win.evaluate(
    ({ id, appDescriptorId, cwd }) =>
      window.codeshell.bindPanelApp({
        guestId: id,
        appDescriptorId,
        tabId: `tab:${appDescriptorId}`,
        bucket: "job-hunt-e2e",
        sessionId: "session-job-hunt-e2e",
        projectPath: cwd,
        cwd,
        visible: true,
        busy: false,
        theme: "light",
        locale: "zh-CN",
      }),
    { id: guestId, appDescriptorId: panel.id, cwd: projectDir },
  );

  await waitForGuest(
    view,
    `document.querySelector("#question-bank-inbox")?.textContent === "2"`,
    "question bank did not load",
  );
  await waitForSnapshot((current) => {
    const question = current.interviewSets?.[0]?.questions?.[0];
    return question && Object.keys(question).sort().join(",") === "bankQuestionId,id,why";
  }, "legacy materialized practice sets did not migrate to compact bank references");
  assert(
    await execute(
      view,
      `(() => {
        const preview = document.querySelector("#resume-preview");
        return preview?.textContent.includes("2025年09月08日 - 至今｜上海") &&
          !preview.textContent.includes("**") &&
          [...preview.querySelectorAll("strong")].some((item) => item.textContent === "2025年09月08日 - 至今｜上海");
      })()`,
    ),
    "inline Markdown remained visible in the resume preview used for PDF export",
  );
  await execute(
    view,
    `(() => {
      document.querySelector('[data-view-target="channels"]')?.click();
      const guide = document.querySelector(".intake-guide");
      if (guide) guide.open = true;
      document.querySelector("#intake-search-sites")?.click();
    })()`,
  );
  await waitForGuest(
    view,
    `(() => {
      const dialog = document.querySelector("#agent-dialog");
      const firstProvider = dialog?.querySelector('#provider-picker input[name="providers"]');
      return dialog?.open === true && firstProvider && document.activeElement === firstProvider;
    })()`,
    "recruiting-site entry did not open and focus channel selection",
  );
  await execute(view, `document.querySelector('[data-close-dialog="agent-dialog"]')?.click()`);
  await execute(view, `document.querySelector('[data-view-target="resumes"]')?.click()`);
  await execute(view, `document.querySelector('[data-resume-workspace="files"]')?.click()`);
  await waitForGuest(
    view,
    `(() => {
      const cards = [...document.querySelectorAll("#resume-file-list > article")];
      return cards.some((card) => card.dataset.format === "markdown") &&
        cards.some((card) => card.dataset.format === "pdf") &&
        cards.every((card) => card.querySelector("[data-open-resume-file-path]") && card.querySelector("[data-reveal-resume-file-path]"));
    })()`,
    "saved Markdown and PDF files did not expose open and reveal actions",
  );
  await execute(view, `document.querySelector('[data-resume-workspace="versions"]')?.click()`);
  await waitForGuest(
    view,
    `document.querySelector("[data-delete-resume-version-id='resume-base-unused-e2e']") != null`,
    "an unreferenced historical Base Resume did not expose a delete action",
  );
  await execute(
    view,
    `document.querySelector("[data-delete-resume-version-id='resume-base-unused-e2e']")?.click()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("#delete-resume-version-dialog")?.open === true && document.querySelector("#confirm-delete-resume-version")?.disabled === false`,
    "the Base Resume deletion confirmation did not open",
  );
  await execute(view, `document.querySelector("#confirm-delete-resume-version")?.click()`);
  const afterHistoricalBaseDelete = await waitForSnapshot(
    (current) =>
      !current.versions.some(
        (record) => (record.versionId || record.id) === "resume-base-unused-e2e",
      ),
    "deleting an unreferenced historical Base Resume did not reach project storage",
  );
  assert(
    (afterHistoricalBaseDelete.resume.versionId || afterHistoricalBaseDelete.resume.id) ===
      "resume-e2e",
    "deleting Base history changed the current resume",
  );
  await waitForGuest(
    view,
    `document.querySelector("#delete-resume-version-dialog")?.open === false && document.querySelector("[data-delete-resume-version-id='resume-base-unused-e2e']") == null`,
    "the deleted Base Resume remained visible in the version library",
  );
  // The real Host intentionally caps a Panel at 30 calls per 10 seconds. This
  // extra destructive-write scenario should start a fresh window before the
  // rest of the high-speed synthetic workflow continues.
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 10_100));
  assert(
    await execute(
      view,
      `document.querySelector("#generate-commit-interview") == null && document.querySelector('[data-workflow-task="commits"]') == null && document.querySelector("#regenerate-interview")?.hidden === true`,
    ),
    "Commit-only generation remained visible or a legacy project set exposed regeneration",
  );
  const mediaCapabilities = await execute(
    view,
    `({
      secureContext: window.isSecureContext,
      origin: location.origin,
      mediaDevices: typeof navigator.mediaDevices,
      getUserMedia: typeof navigator.mediaDevices?.getUserMedia,
      mediaRecorder: typeof window.MediaRecorder,
    })`,
  );
  assert(
    mediaCapabilities.secureContext === true &&
      mediaCapabilities.mediaDevices === "object" &&
      mediaCapabilities.getUserMedia === "function" &&
      mediaCapabilities.mediaRecorder === "function",
    `Panel audio browser APIs are unavailable: ${JSON.stringify(mediaCapabilities)}`,
  );
  await execute(view, `document.querySelector('[data-view-target="materials"]')?.click()`);
  await waitForGuest(
    view,
    `document.querySelector("#edit-candidate-profile")?.hidden === false && document.querySelector("#profile-role")?.readOnly === true`,
    "candidate profile did not expose direct project editing",
  );
  await execute(
    view,
    `(() => {
      document.querySelector("#edit-candidate-profile")?.click();
      const role = document.querySelector("#profile-role");
      role.value = "这条修改不应丢失";
      role.dispatchEvent(new Event("input", { bubbles: true }));
      window.confirm = () => false;
      document.querySelector('[data-view-target="interviews"]')?.click();
    })()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("#view-materials")?.classList.contains("active") && document.querySelector("#profile-role")?.value === "这条修改不应丢失" && document.querySelector("#save-candidate-profile")?.hidden === false && document.querySelector("#candidate-profile-note")?.dataset.state === "dirty"`,
    "candidate profile navigation discarded an edit without confirmation",
  );
  await execute(
    view,
    `(() => {
      window.confirm = () => true;
      document.querySelector("#cancel-candidate-profile")?.click();
    })()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("#profile-role")?.value === "AI 应用工程师" && document.querySelector("#profile-role")?.readOnly === true`,
    "confirmed candidate profile discard did not restore project state",
  );
  await execute(view, `document.querySelector("#edit-candidate-profile")?.click()`);
  await execute(
    view,
    `(() => {
      const role = document.querySelector("#profile-role");
      role.value = "高级 AI 应用工程师";
      document.querySelector("#save-candidate-profile")?.click();
    })()`,
  );
  await waitForSnapshot(
    (current) => current.profile?.role === "高级 AI 应用工程师",
    "direct candidate profile edit did not reach project state",
  );
  await waitForGuest(
    view,
    `document.querySelector("#profile-role")?.value === "高级 AI 应用工程师" && document.querySelector("#profile-role")?.readOnly === true && document.querySelector("#edit-candidate-profile")?.hidden === false`,
    "saved candidate profile did not return to a stable read-only state",
  );
  await execute(
    view,
    `document.querySelector('[data-view-target="interviews"]')?.click()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("#interview-quick-start-title")?.textContent.includes("2 道旧题只缺能力标签") && document.querySelector("#quick-practice-interview-question")?.textContent.includes("整理并练第 1 题") && document.querySelector("#repair-interview-library")?.textContent.includes("修复并确认 2 道") && document.querySelector("#quick-practice-interview-question")?.disabled === false && document.querySelector("#interview-readiness-questions-title")?.textContent.includes("2 道题整理后可练") && document.querySelector("#interview-readiness-score-title")?.textContent.includes("评分与项目回写可用") && document.querySelector("#interview-readiness-voice")?.dataset.state !== "checking"`,
    "legacy interview quick start did not become confirmable",
  );
  await execute(
    view,
    `(() => {
      const quickStart = document.querySelector("#quick-practice-interview-question");
      quickStart.focus();
      quickStart.click();
    })()`,
  );
  await waitForGuest(
    view,
    `(() => {
      const stage = document.querySelector("#panel-interview-stage");
      if (!stage || stage.hidden) return false;
      const rect = stage.getBoundingClientRect();
      return getComputedStyle(stage).position === "fixed" && rect.width >= innerWidth * 0.9 && rect.height >= innerHeight * 0.9 && document.querySelector("#panel-interview-reference")?.hidden === false && document.querySelector("#panel-interview-reference-answer")?.textContent.includes("状态机");
    })()`,
    "Panel-native interview did not open",
  );
  await execute(
    view,
    `(() => {
      const close = document.querySelector("#close-panel-interview");
      close.focus();
      close.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    })()`,
  );
  await waitForGuest(
    view,
    `(() => {
      const stage = document.querySelector("#panel-interview-stage");
      const controls = [...stage.querySelectorAll('button:not([disabled]):not([hidden]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')].filter((control) => control.getClientRects().length > 0);
      return document.activeElement === controls.at(-1);
    })()`,
    "Panel-native interview did not wrap backward keyboard focus",
  );
  await execute(
    view,
    `document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }))`,
  );
  await waitForGuest(
    view,
    `document.activeElement?.id === "close-panel-interview"`,
    "Panel-native interview did not keep keyboard focus inside the dialog",
  );
  await execute(view, `document.querySelector("#close-panel-interview")?.click()`);
  await waitForGuest(
    view,
    `document.querySelector("#panel-interview-stage")?.hidden === true && document.activeElement?.id === "quick-practice-interview-question"`,
    "Panel-native interview did not restore focus to its launch action",
  );
  await execute(view, `document.querySelector("#quick-practice-interview-question")?.click()`);
  await waitForGuest(
    view,
    `document.querySelector("#panel-interview-stage")?.hidden === false && document.activeElement?.id === "panel-interview-answer"`,
    "Panel-native interview did not reopen with answer focus",
  );
  await execute(view, `document.querySelector("#panel-interview-use-reference-answer")?.click()`);
  await waitForGuest(
    view,
    `document.querySelector("#panel-interview-answer")?.value.includes("状态机") && document.querySelector("#panel-interview-draft-state")?.textContent.includes("草稿已保留")`,
    "project-backed reference answer did not become an editable draft",
  );
  await execute(
    view,
    `(() => {
      const answer = document.querySelector("#panel-interview-answer");
      answer.value = "这是一段尚未提交、需要在面板重载后恢复的回答草稿。";
      answer.dispatchEvent(new Event("input", { bubbles: true }));
    })()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("#panel-interview-draft-state")?.textContent.includes("草稿已保留")`,
    "interview draft was not retained locally",
  );
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  await view.evaluate((candidate) => candidate.reload());
  await waitForGuest(
    view,
    `document.querySelector("#question-bank-total")?.textContent === "2"`,
    "question bank did not reload after a draft-only refresh",
  );
  await execute(
    view,
    `document.querySelector('[data-view-target="interviews"]')?.click()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("#quick-practice-interview-question")?.disabled === false`,
    "draft refresh did not restore the interview launcher",
  );
  await execute(view, `document.querySelector("#quick-practice-interview-question")?.click()`);
  await waitForGuest(
    view,
    `document.querySelector("#panel-interview-stage")?.hidden === false && document.querySelector("#panel-interview-answer")?.value.includes("面板重载后恢复") && document.querySelector("#panel-interview-draft-state")?.textContent.includes("已恢复未提交草稿")`,
    "an unsent interview draft did not recover after reloading the Panel",
  );
  await execute(
    view,
    `(() => {
      const answer = document.querySelector("#panel-interview-answer");
      answer.value = "我会为每次执行保存 checkpoint，并用幂等键保护有副作用的工具调用。";
      answer.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#submit-panel-interview-answer")?.click();
    })()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("#panel-interview-hint")?.textContent.includes("已保存到项目") && document.querySelector("#panel-interview-next-actions")?.dataset.step === "score" && document.querySelector("#panel-interview-flow-answer")?.dataset.state === "complete" && document.querySelector("#panel-interview-flow-score")?.textContent.includes("点击开始评分") && document.querySelector("#panel-interview-score-answer")?.hidden === false && document.querySelector("#panel-interview-score-answer")?.disabled === false && document.querySelector("#panel-interview-score-answer")?.textContent.includes("评分并优化") && document.querySelector("#panel-interview-score-note")?.textContent.includes("项目证据")`,
    "interview answer was not saved",
  );
  const guestSnapshotFile = await execute(
    view,
    `window.codeshellPanel.call("workspace.readText", { path: "job-hunt-panel.json" })`,
  );
  const guestSnapshot = JSON.parse(guestSnapshotFile.content);
  const afterInterview = JSON.parse(await readFile(snapshotPath, "utf8"));
  assert(
    afterInterview.questionBank.filter(
      (item) => item.status === "ready" && item.competency.length > 0,
    ).length === 1,
    "single-question practice did not upgrade exactly one legacy question",
  );
  const savedQuestion = afterInterview.questionBank.find((item) =>
    item.practiceAttempts?.some((attempt) => attempt.answer.includes("checkpoint")),
  );
  const savedAttempt = savedQuestion?.practiceAttempts?.[0];
  if (!savedAttempt) {
    console.error(
      JSON.stringify(
        {
          rootKeys: Object.keys(afterInterview),
          dataFiles: afterInterview.dataFiles,
          guestContext: await execute(view, `window.codeshellPanel.getContext()`),
          guestRevision: guestSnapshotFile.revision,
          guestAttempts: guestSnapshot.questionBank?.map((item) => ({
            id: item.id,
            attempts: item.practiceAttempts,
          })),
          hint: await execute(view, `document.querySelector("#panel-interview-hint")?.textContent`),
          questionCount: afterInterview.questionBank?.length,
          attempts: afterInterview.questionBank?.map((item) => ({
            id: item.id,
            attempts: item.practiceAttempts,
          })),
        },
        null,
        2,
      ),
    );
  }
  assert(
    savedAttempt?.answer.includes("checkpoint"),
    "typed interview answer did not reach project state",
  );
  assert(savedAttempt?.inputMode === "typed", "typed interview input mode was not retained");
  assert(
    afterInterview.mockInterviewSessions.length === 0,
    "single-question practice unexpectedly created a full mock session",
  );
  const savedSet = afterInterview.interviewSets.find((item) =>
    item.questions?.some((question) => question.bankQuestionId === savedQuestion.id),
  );
  const savedSetQuestion = savedSet?.questions?.find(
    (item) => item.bankQuestionId === savedQuestion.id,
  );
  assert(savedSetQuestion, "saved answer lost its exact interview-set question mapping");
  const detachedTraceId = "session-detached-review-e2e";
  const recoveredReview = await win.evaluate(
    ({ appDescriptorId, bankQuestionId, interviewSetId, questionId, practiceAttemptId, traceId }) =>
      window.codeshell.invokePanelAppAgentTool({
        appDescriptorId,
        bucket: "job-hunt-e2e",
        toolName: "save_interview_practice_review",
        arguments: {
          trace_id: traceId,
          interview_set_id: interviewSetId,
          question_id: questionId,
          bank_question_id: bankQuestionId,
          practice_attempt_id: practiceAttemptId,
          answer_summary: "候选人说明了 checkpoint 与有副作用工具的幂等保护。",
          dimensions: { evidence: 76, structure: 72, depth: 68, relevance: 80 },
          strengths: ["包含可核验的恢复与幂等设计"],
          improvements: ["补充个人职责和验证结果"],
          optimized_answer:
            "我负责运行状态恢复边界的设计：每次执行保存 checkpoint，并用幂等键保护有副作用的工具调用；恢复时只重放安全步骤，避免重复产生外部影响。",
          follow_up: "你如何验证恢复后没有重复执行外部写操作？",
        },
      }),
    {
      appDescriptorId: panel.id,
      bankQuestionId: savedQuestion.id,
      interviewSetId: savedSet.id,
      questionId: savedSetQuestion.id,
      practiceAttemptId: savedAttempt.id,
      traceId: detachedTraceId,
    },
  );
  assert(recoveredReview.saved === true, "detached review was not written back");
  assert(recoveredReview.traceRecovered === true, "detached review did not recover its Trace");
  assert(
    recoveredReview.traceId?.startsWith("panel-trace-"),
    "recovered review did not receive an unambiguous Panel Trace ID",
  );
  const retriedRecoveredReview = await win.evaluate(
    ({ appDescriptorId, bankQuestionId, interviewSetId, questionId, practiceAttemptId, traceId }) =>
      window.codeshell.invokePanelAppAgentTool({
        appDescriptorId,
        bucket: "job-hunt-e2e",
        toolName: "save_interview_practice_review",
        arguments: {
          trace_id: traceId,
          interview_set_id: interviewSetId,
          question_id: questionId,
          bank_question_id: bankQuestionId,
          practice_attempt_id: practiceAttemptId,
          answer_summary: "候选人说明了 checkpoint 与有副作用工具的幂等保护。",
          dimensions: { evidence: 76, structure: 72, depth: 68, relevance: 80 },
          strengths: ["包含可核验的恢复与幂等设计"],
          improvements: ["补充个人职责和验证结果"],
          optimized_answer:
            "我负责运行状态恢复边界的设计：每次执行保存 checkpoint，并用幂等键保护有副作用的工具调用；恢复时只重放安全步骤，避免重复产生外部影响。",
          follow_up: "你如何验证恢复后没有重复执行外部写操作？",
        },
      }),
    {
      appDescriptorId: panel.id,
      bankQuestionId: savedQuestion.id,
      interviewSetId: savedSet.id,
      questionId: savedSetQuestion.id,
      practiceAttemptId: savedAttempt.id,
      traceId: detachedTraceId,
    },
  );
  assert(
    retriedRecoveredReview.practiceReviewId === recoveredReview.practiceReviewId &&
      retriedRecoveredReview.reviewCount === 1,
    "retrying the same Trace created a duplicate practice review",
  );
  const completedRecoveryTrace = await win.evaluate(
    ({ appDescriptorId, traceId, reviewId }) =>
      window.codeshell.invokePanelAppAgentTool({
        appDescriptorId,
        bucket: "job-hunt-e2e",
        toolName: "complete_execution_trace",
        arguments: {
          trace_id: traceId,
          status: "completed",
          summary: "已写回评分与项目优化稿",
          output_refs: [`practice-review:${reviewId}`],
        },
      }),
    {
      appDescriptorId: panel.id,
      traceId: detachedTraceId,
      reviewId: recoveredReview.practiceReviewId,
    },
  );
  assert(completedRecoveryTrace.recorded === true, "recovered Trace could not be completed");
  assert(
    completedRecoveryTrace.traceId === recoveredReview.traceId,
    "old Trace alias did not resolve to the same recovered Trace",
  );
  await waitForGuest(
    view,
    `document.querySelector("#panel-interview-feedback .practice-optimized-answer")?.open === true && document.querySelector("#panel-interview-feedback .practice-optimized-answer")?.textContent.includes("checkpoint") && document.querySelector("#panel-interview-feedback .practice-review-meta")?.textContent.includes("第 1 次回答 · 1 次评分") && document.querySelector("#panel-interview-next-actions")?.dataset.step === "improve" && document.querySelector("#panel-interview-flow-score")?.textContent.includes("已评分 74") && document.querySelector("#panel-interview-flow-improve")?.dataset.state === "current" && document.querySelector("#panel-interview-use-optimized-answer")?.hidden === false && document.querySelector("#panel-interview-follow-up")?.hidden === false && document.querySelector("#panel-interview-follow-up-question")?.textContent.includes("如何验证") && document.querySelector("#interview-training-insights")?.hidden === false && document.querySelector("#interview-training-average")?.textContent === "74" && document.querySelector("#interview-latest-feedback-question")?.textContent.includes("Agent 工具调用")`,
    "recovered optimized answer was not shown in the active interview",
  );
  const afterRecoveredReview = JSON.parse(await readFile(snapshotPath, "utf8"));
  assert(
    afterRecoveredReview.questionBank.find((item) => item.id === savedQuestion.id)
      ?.practiceReviews?.[0]?.overallScore === 74,
    "recovered review did not persist to project state",
  );
  assert(
    afterRecoveredReview.questionBank.find((item) => item.id === savedQuestion.id)
      ?.practiceReviews?.[0]?.practiceAttemptId === savedAttempt.id,
    "review did not retain the exact answer attempt it scored",
  );
  await waitForGuest(
    view,
    `document.querySelector("#panel-interview-retry-answer")?.hidden === false && document.querySelector("#panel-interview-use-optimized-answer")?.hidden === false`,
    "scored answer did not expose retry and optimized-draft actions",
  );
  await execute(
    view,
    `(() => {
      const answer = document.querySelector("#panel-interview-answer");
      answer.value += " 这是尚未保存的更改。";
      answer.dispatchEvent(new Event("input", { bubbles: true }));
    })()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("#panel-interview-score-answer")?.disabled === true && document.querySelector("#panel-interview-next-question")?.disabled === true && document.querySelector("#panel-interview-score-note")?.textContent.includes("先点“更新回答”")`,
    "unsaved edits did not block scoring the prior saved answer",
  );
  await execute(
    view,
    `(() => {
      const answer = document.querySelector("#panel-interview-answer");
      answer.value = ${JSON.stringify(savedAttempt.answer)};
      answer.dispatchEvent(new Event("input", { bubbles: true }));
    })()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("#panel-interview-score-answer")?.disabled === false && document.querySelector("#panel-interview-next-question")?.disabled === false`,
    "restoring the saved answer did not unlock its exact scoring actions",
  );
  await execute(view, `document.querySelector("#panel-interview-use-optimized-answer")?.click()`);
  await waitForGuest(
    view,
    `document.querySelector("#panel-interview-answer")?.value.includes("checkpoint") && document.querySelector("#submit-panel-interview-answer")?.disabled === false && document.querySelector("#panel-interview-draft-state")?.textContent.includes("草稿已保留") && document.querySelector("#panel-interview-next-actions")?.hidden === true`,
    "optimized answer did not become an unsaved editable draft",
  );
  await execute(
    view,
    `(() => {
      const answer = document.querySelector("#panel-interview-answer");
      answer.value = "第二次回答补充了失败恢复的验证边界。";
      answer.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#submit-panel-interview-answer")?.click();
    })()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("#panel-interview-hint")?.textContent.includes("已保存到项目") && !document.querySelector("#panel-interview-feedback")?.textContent.includes("我负责运行状态恢复边界") && document.querySelector("#panel-interview-feedback .practice-history")?.textContent.includes("本题练习历史 · 2 次") && document.querySelector("#panel-interview-feedback .practice-history")?.textContent.includes("74 分") && document.querySelector("#panel-interview-feedback .practice-history-item.current")?.textContent.includes("待评分")`,
    "a new retry incorrectly displayed the prior attempt's score",
  );
  await execute(view, `document.querySelector("#close-panel-interview")?.click()`);
  await waitForGuest(
    view,
    `document.querySelector("[data-score-question-id='set-question-1']")?.textContent.includes("评分并优化")`,
    "saved answer did not expose a scoring action on its question card",
  );
  await waitForGuest(
    view,
    `document.querySelector("#quick-start-interview")?.textContent.includes("整理并练整套 · 2 题")`,
    "remaining legacy questions were not offered for the full mock",
  );
  await execute(view, `document.querySelector("#quick-start-interview")?.click()`);
  await waitForGuest(
    view,
    `document.querySelector("#question-bank-ready")?.textContent === "2" && document.querySelector("#panel-interview-stage")?.hidden === false && document.querySelector("#panel-interview-answer")?.disabled === false`,
    "full mock did not confirm the remaining legacy questions",
    30_000,
  );
  const afterFullMock = JSON.parse(await readFile(snapshotPath, "utf8"));
  assert(
    afterFullMock.questionBank.every(
      (item) => item.status === "ready" && item.competency.length > 0,
    ),
    "full mock did not upgrade every legacy question",
  );
  assert(
    afterFullMock.mockInterviewSessions[0]?.questionCount === 2,
    "full mock session did not reach project state",
  );
  await execute(
    view,
    `(() => {
      const answer = document.querySelector("#panel-interview-answer");
      answer.value = "完整模拟的第一题回答，用于验证可继续面试。";
      answer.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#submit-panel-interview-answer")?.click();
    })()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("#panel-interview-hint")?.textContent.includes("已保存到项目")`,
    "full mock answer was not saved",
    25_000,
  );
  await execute(view, `document.querySelector("#close-panel-interview")?.click()`);
  await waitForGuest(
    view,
    `document.querySelector("#continue-interview-session")?.hidden === false && document.querySelector("#continue-interview-session")?.textContent.includes("继续")`,
    "a partially answered mock did not expose Continue",
  );
  await execute(view, `document.querySelector("#continue-interview-session")?.click()`);
  await waitForGuest(
    view,
    `document.querySelector("#panel-interview-stage")?.hidden === false`,
    "Continue did not reopen the saved mock in the Panel",
  );
  const audioStatus = await execute(view, `window.codeshellPanel.call("audio.status", {})`);
  assert(typeof audioStatus.available === "boolean", "Panel audio status bridge was not callable");

  await execute(
    view,
    `(() => {
      const answer = document.querySelector("#panel-interview-answer");
      answer.value = "完整模拟的第二题回答，用于验证完成状态先落项目再退出。";
      answer.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#submit-panel-interview-answer")?.click();
    })()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("#panel-interview-hint")?.textContent.includes("已保存到项目") && document.querySelector("#panel-interview-next-question")?.textContent.includes("完成本场")`,
    "final full-mock answer was not ready to complete",
    25_000,
  );
  await execute(view, `document.querySelector("#panel-interview-next-question")?.click()`);
  await waitForGuest(
    view,
    `document.querySelector("#panel-interview-stage")?.hidden === true && [...document.querySelectorAll("#mock-session-list article")].some((card) => card.dataset.status === "completed" && card.textContent.includes("2/2 题已回答") && card.textContent.includes("2 道待评分") && card.querySelector("[data-score-mock-session-id]"))`,
    "full mock closed before its completed state reached the project",
    25_000,
  );
  const afterCompletedMock = JSON.parse(await readFile(snapshotPath, "utf8"));
  assert(
    afterCompletedMock.mockInterviewSessions.find((item) => item.interviewSetId === "set-e2e")
      ?.status === "completed",
    "completed full mock did not persist before the stage closed",
  );

  await execute(view, `document.querySelector("#quick-ten-minute-interview")?.click()`);
  try {
    await waitForGuest(
      view,
      `document.querySelector("#panel-interview-stage")?.hidden === false && document.querySelector("#panel-interview-progress")?.textContent.includes("10 分钟") && document.querySelector("#panel-interview-answer")?.disabled === false`,
      "ten-minute practice did not start without an interview set",
    );
  } catch (error) {
    const diagnostic = await execute(
      view,
      `({
        buttonDisabled: document.querySelector("#quick-ten-minute-interview")?.disabled,
        buttonText: document.querySelector("#quick-ten-minute-interview")?.textContent,
        stageHidden: document.querySelector("#panel-interview-stage")?.hidden,
        progress: document.querySelector("#panel-interview-progress")?.textContent,
        answerDisabled: document.querySelector("#panel-interview-answer")?.disabled,
        toast: document.querySelector("#toast")?.textContent,
        quickTitle: document.querySelector("#interview-quick-start-title")?.textContent,
      })`,
    );
    throw new Error(`${error.message}: ${JSON.stringify(diagnostic)}`);
  }
  await execute(
    view,
    `(() => {
      const answer = document.querySelector("#panel-interview-answer");
      answer.value = "快速训练第一题回答，用来验证无题单场次也能恢复。";
      answer.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#submit-panel-interview-answer")?.click();
    })()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("#panel-interview-hint")?.textContent.includes("已保存到项目")`,
    "ten-minute practice answer was not saved",
    25_000,
  );
  await execute(view, `document.querySelector("#close-panel-interview")?.click()`);
  await waitForGuest(
    view,
    `[...document.querySelectorAll("#mock-session-list article")].some((card) => card.textContent.includes("10 分钟面试训练") && card.querySelector("[data-resume-mock-session-id]")?.disabled === false)`,
    "set-less ten-minute practice was not resumable from history",
  );
  await execute(
    view,
    `[...document.querySelectorAll("#mock-session-list article")].find((card) => card.textContent.includes("10 分钟面试训练"))?.querySelector("[data-resume-mock-session-id]")?.click()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("#panel-interview-stage")?.hidden === false && document.querySelector("#panel-interview-progress")?.textContent.includes("10 分钟")`,
    "set-less ten-minute practice did not resume in the Panel",
  );
  await execute(view, `document.querySelector("#close-panel-interview")?.click()`);
  const beforeEmptyMockCount = JSON.parse(await readFile(snapshotPath, "utf8"))
    .mockInterviewSessions.length;
  await execute(view, `document.querySelector("#quick-ten-minute-interview")?.click()`);
  await waitForGuest(
    view,
    `document.querySelector("#panel-interview-stage")?.hidden === false && document.querySelector("#panel-interview-answer")?.disabled === false`,
    "empty ten-minute practice did not start durably",
    25_000,
  );
  await waitForSnapshot(
    (current) => current.mockInterviewSessions.length === beforeEmptyMockCount + 1,
    "empty mock was not stored before opening",
  );
  await execute(view, `document.querySelector("#close-panel-interview")?.click()`);
  await waitForSnapshot(
    (current) => current.mockInterviewSessions.length === beforeEmptyMockCount,
    "closing an unanswered mock did not remove it from the project",
  );
  await execute(
    view,
    `document.querySelector('[data-interview-workspace="bank"]')?.click()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("#interview-bank-workspace")?.hidden === false && document.querySelector("[data-practice-bank-question-id]")?.textContent.includes("练习这道题")`,
    "ready question did not expose a direct practice action in the bank",
  );
  await execute(
    view,
    `(() => {
      const sort = document.querySelector("#question-bank-sort");
      sort.value = "recent";
      sort.dispatchEvent(new Event("change", { bubbles: true }));
      document.querySelector('[data-question-bank-filter="ready"]')?.click();
    })()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("#question-bank-result-summary")?.textContent.includes("最近更新") && document.querySelector('[data-question-bank-filter="ready"]')?.getAttribute("aria-pressed") === "true" && document.querySelector("#question-bank-reset-filters")?.disabled === false`,
    "question-bank status shortcuts and sorting did not update the visible result set",
  );
  await execute(view, `document.querySelector("#question-bank-reset-filters")?.click()`);
  await waitForGuest(
    view,
    `document.querySelector("#question-bank-sort")?.value === "smart" && document.querySelector("#question-bank-status-filter")?.value === "active" && document.querySelector("#question-bank-reset-filters")?.disabled === true`,
    "question-bank filters did not reset to the durable defaults",
  );
  await execute(view, `document.querySelector("[data-practice-bank-question-id]")?.click()`);
  await waitForGuest(
    view,
    `document.querySelector("#panel-interview-stage")?.hidden === false && document.querySelector("[data-interview-workspace='practice']")?.classList.contains("active")`,
    "question-bank practice did not switch to the visible practice workspace",
  );
  await execute(view, `document.querySelector("#close-panel-interview")?.click()`);
  await execute(
    view,
    `document.querySelector("[data-edit-bank-question-id='bank-e2e-agent']")?.click()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("#question-bank-dialog")?.open === true && document.querySelectorAll(".question-bank-editor-section").length === 3 && document.querySelector("#question-bank-editor-readiness")?.dataset.state === "ready" && document.querySelector('#question-bank-form button[value="save"]')?.textContent.includes("返回题库") && document.querySelector('#question-bank-form button[value="practice"]')?.disabled === false`,
    "structured question editor did not open with a visible save and practice decision",
  );
  await execute(
    view,
    `(() => {
      document.querySelector("#question-bank-notes").value = "E2E 手动优化笔记已可靠写入项目。";
      document.querySelector("#question-bank-form button[value='save']")?.click();
    })()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("#question-bank-dialog")?.open === false`,
    "manual question editor closed before its project write completed",
    25_000,
  );
  await waitForGuest(
    view,
    `document.querySelector('[data-bank-question-id="bank-e2e-agent"].is-recently-saved')?.textContent.includes("刚刚保存") && document.activeElement?.dataset.bankQuestionId === "bank-e2e-agent"`,
    "saved question was not visibly refreshed and focused in the question bank",
  );
  await waitForSnapshot(
    (current) =>
      current.questionBank.find((item) => item.id === "bank-e2e-agent")?.notes ===
      "E2E 手动优化笔记已可靠写入项目。",
    "manual question optimization did not reach project state",
  );

  await execute(
    view,
    `document.querySelector('[data-view-target="resumes"]')?.click()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("[data-resume-qa-id='resume-qa-e2e']") != null`,
    "private resume QA did not render",
  );
  await execute(
    view,
    `document.querySelector("[data-toggle-resume-qa-skip-id='resume-qa-e2e']")?.click()`,
  );
  await waitForSnapshot(
    (current) =>
      current.resume.candidateQuestions.find((item) => item.id === "resume-qa-e2e")?.status ===
      "skipped",
    "resume QA skip state did not reach project state",
  );
  await waitForGuest(
    view,
    `document.querySelector("[data-toggle-resume-qa-skip-id='resume-qa-e2e']")?.textContent.includes("重新打开")`,
    "resume QA skip action did not finish in a stable state",
  );
  await execute(
    view,
    `document.querySelector("[data-toggle-resume-qa-skip-id='resume-qa-e2e']")?.click()`,
  );
  await waitForSnapshot(
    (current) =>
      current.resume.candidateQuestions.find((item) => item.id === "resume-qa-e2e")?.status ===
      "open",
    "resume QA reopen state did not reach project state",
  );
  await execute(view, `document.querySelector("[data-resume-qa-id='resume-qa-e2e']")?.click()`);
  await waitForGuest(
    view,
    `document.querySelector("#resume-qa-dialog")?.open === true`,
    "Panel-native resume QA dialog did not open",
  );
  await execute(
    view,
    `(() => {
      document.querySelector("#resume-qa-answer").value = "把三步手工整理缩短为一次面板保存，并保留失败重试入口。";
      document.querySelector("#resume-qa-status").value = "answered";
      document.querySelector("#resume-qa-form button[value='close']")?.click();
    })()`,
  );
  try {
    await waitForGuest(
      view,
      `document.querySelector("#resume-qa-dialog")?.open === false`,
      "resume QA answer was not saved",
      25_000,
    );
  } catch (error) {
    const state = await execute(
      view,
      `({
        error: document.querySelector("#resume-qa-dialog-error")?.textContent,
        toast: document.querySelector("#toast")?.textContent,
        snapshot: document.querySelector("#project-snapshot-state")?.textContent,
        snapshotTitle: document.querySelector("#project-snapshot-state")?.title,
      })`,
    );
    throw new Error(`${error.message}: ${JSON.stringify(state)}`);
  }
  const afterResumeQa = JSON.parse(await readFile(snapshotPath, "utf8"));
  const savedQa = afterResumeQa.resume.candidateQuestions.find(
    (item) => item.id === "resume-qa-e2e",
  );
  assert(savedQa?.status === "answered", "resume QA status did not reach project state");
  assert(savedQa?.answer.includes("三步手工整理"), "resume QA answer did not reach project state");
  assert(
    savedQa?.sourceRefs.includes("user:resume-qa:resume-qa-e2e"),
    "explicit candidate confirmation source was not retained",
  );
  await execute(
    view,
    `document.querySelector("[data-open-resume-version-id='resume-variant-e2e']")?.click()`,
  );
  const afterVariantRestore = await waitForSnapshot(
    (current) =>
      current.resume.kind === "variant" &&
      current.resume.parentVersionId === "resume-variant-e2e" &&
      current.resume.revisionReason === "从历史版本恢复",
    "restoring a historical job variant did not create a new project revision",
  );
  const restoredVariantRevisionId =
    afterVariantRestore.resume.versionId || afterVariantRestore.resume.id;
  assert(
    restoredVariantRevisionId !== "resume-variant-e2e" &&
      afterVariantRestore.versions.some(
        (item) => (item.versionId || item.id) === "resume-variant-e2e",
      ),
    "restoring history reused or removed the immutable historical revision",
  );
  await waitForGuest(
    view,
    `document.querySelector("#resume-variant-review")?.hidden === false && document.querySelector("#resume-variant-review-count")?.textContent === "1" && document.querySelector("#resume-variant-review-list")?.textContent.includes("user:e2e")`,
    "job variant did not expose its Base-to-job review with Source",
  );
  await execute(
    view,
    `document.querySelector("[data-resume-variant-change-id='resume-change-e2e'][data-resume-variant-decision='reverted']")?.click()`,
  );
  await waitForGuest(
    view,
    `document.querySelector(".resume-variant-change-card[data-status='reverted']") != null && document.querySelector("#resume-preview")?.textContent.includes("设计并实现面板原生模拟面试流程")`,
    "restoring Base wording did not update the active job variant",
  );
  const afterVariantRevert = await waitForSnapshot(
    (current) =>
      current.resume.kind === "variant" &&
      current.resume.variantChanges?.some(
        (item) => item.id === "resume-change-e2e" && item.status === "reverted",
      ),
    "restoring Base wording did not reach project state",
  );
  assert(
    afterVariantRevert.resume.kind === "variant" &&
      afterVariantRevert.resume.parentVersionId === restoredVariantRevisionId &&
      afterVariantRevert.resume.revisionReason.includes("恢复 Base 表述") &&
      afterVariantRevert.resume.markdown.includes("设计并实现面板原生模拟面试流程。") &&
      !afterVariantRevert.resume.markdown.includes("可恢复的面板原生"),
    "Base wording restoration did not reach project state",
  );
  assert(
    afterVariantRevert.versions.some(
      (item) =>
        (item.versionId || item.id) === "resume-variant-e2e" &&
        item.markdown.includes("可恢复的面板原生模拟面试流程"),
    ),
    "the pre-decision job variant was not retained as an immutable revision",
  );
  assert(
    afterVariantRevert.versions
      .find((item) => (item.versionId || item.id) === "resume-e2e")
      ?.markdown.includes("设计并实现面板原生模拟面试流程。"),
    "reviewing a job variant changed the archived Base Resume",
  );
  await execute(
    view,
    `document.querySelector("[data-resume-variant-change-id='resume-change-e2e'][data-resume-variant-decision='kept']")?.click()`,
  );
  await waitForGuest(
    view,
    `document.querySelector(".resume-variant-change-card[data-status='kept']") != null && document.querySelector("#resume-preview")?.textContent.includes("可恢复的面板原生模拟面试流程")`,
    "re-applying the job wording did not complete the undo loop",
  );
  await waitForSnapshot(
    (current) =>
      current.resume.variantChanges?.some(
        (item) => item.id === "resume-change-e2e" && item.status === "kept",
      ),
    "re-applied job wording did not reach project state",
  );
  await execute(
    view,
    `document.querySelector("[data-edit-resume-variant-change-id='resume-change-e2e']")?.click()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("[data-resume-variant-edit-input='resume-change-e2e']") != null`,
    "job wording did not expose an inline editor",
  );
  await execute(
    view,
    `(() => {
      const input = document.querySelector("[data-resume-variant-edit-input='resume-change-e2e']");
      input.value = "设计并实现具备失败恢复与可审计写回的面板原生模拟面试流程。";
      document.querySelector("[data-save-resume-variant-edit-id='resume-change-e2e']")?.click();
    })()`,
  );
  await waitForGuest(
    view,
    `document.querySelector(".resume-variant-change-status.kept")?.textContent.includes("已编辑并采用") && document.querySelector("#resume-preview")?.textContent.includes("失败恢复与可审计写回")`,
    "edited job wording did not update the active variant",
  );
  const afterVariantEdit = await waitForSnapshot(
    (current) =>
      current.resume.variantChanges?.some(
        (item) =>
          item.id === "resume-change-e2e" && item.status === "kept" && item.userEdited === true,
      ),
    "edited job wording did not reach project state",
  );
  assert(
    afterVariantEdit.resume.markdown.includes("失败恢复与可审计写回") &&
      afterVariantEdit.resume.parentVersionId &&
      afterVariantEdit.resume.revisionReason === "编辑并采用岗位表述" &&
      !afterVariantEdit.versions
        .find((item) => (item.versionId || item.id) === "resume-e2e")
        ?.markdown.includes("失败恢复与可审计写回"),
    "inline job wording edit changed the archived Base Resume",
  );
  const beforeManualRevisionId = afterVariantEdit.resume.versionId || afterVariantEdit.resume.id;
  await execute(view, `document.querySelector("[data-resume-mode='edit']")?.click()`);
  await waitForGuest(
    view,
    `document.querySelector("#resume-editor")?.hidden === false`,
    "resume editor did not open before the manual revision test",
  );
  const manualEditResult = await execute(
    view,
    `(() => {
      try {
        const editor = document.querySelector("#resume-editor");
        if (!editor) return { ok: false, error: "resume editor missing" };
        editor.value += String.fromCharCode(10, 10) + "<!-- e2e manual revision -->";
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error?.stack || error) };
      }
    })()`,
  );
  assert(manualEditResult.ok, `manual resume editor input failed: ${manualEditResult.error}`);
  const afterManualRevision = await waitForSnapshot(
    (current) =>
      current.resume.parentVersionId === beforeManualRevisionId &&
      current.resume.revisionReason === "手动编辑简历正文" &&
      current.resume.markdown.includes("e2e manual revision"),
    "the first direct editor change did not fork a new resume revision",
  );
  assert(
    afterManualRevision.versions.some(
      (item) => (item.versionId || item.id) === beforeManualRevisionId,
    ),
    "the direct editor revision did not retain its parent version",
  );
  await execute(
    view,
    `(() => {
      const editor = document.querySelector("#resume-editor");
      editor.value += String.fromCharCode(10, 10) + "E2E 未同步简历恢复验证";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    })()`,
  );
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  const criticalDraftBeforeReload = await execute(
    view,
    `JSON.parse(localStorage.getItem("job-hunt-critical-drafts-v1") || "null")`,
  );
  assert(
    criticalDraftBeforeReload?.resumeDraft?.markdown?.includes("E2E 未同步简历恢复验证"),
    "the synchronous resume recovery draft was missing before Panel reload",
  );
  await view.evaluate((candidate) => candidate.reload());
  await waitForGuest(
    view,
    `document.readyState === "complete" && document.querySelector("#resume-editor") != null`,
    "Panel did not finish reloading before resume draft recovery",
    25_000,
  );
  try {
    await waitForGuest(
      view,
      `document.querySelector("#resume-editor")?.value.includes("E2E 未同步简历恢复验证")`,
      "the synchronous resume recovery draft did not return to the editor",
      25_000,
    );
  } catch (error) {
    const recoveryState = await execute(
      view,
      `(async () => ({
        critical: JSON.parse(localStorage.getItem("job-hunt-critical-drafts-v1") || "null"),
        cached: await window.codeshellPanel.call("storage.get", { key: "job-hunt-state-v1" }).catch((failure) => ({ error: String(failure) })),
        editor: document.querySelector("#resume-editor")?.value,
        view: document.querySelector("#view-resumes")?.hidden,
        sync: document.querySelector("#project-snapshot-state")?.textContent,
        toast: document.querySelector("#toast")?.textContent,
      }))()`,
    );
    const projectState = JSON.parse(await readFile(snapshotPath, "utf8"));
    throw new Error(
      `${error.message}: ${JSON.stringify({
        recoveryState,
        projectResume: {
          versionId: projectState.resume?.versionId || projectState.resume?.id,
          parentVersionId: projectState.resume?.parentVersionId,
          tail: String(projectState.resume?.markdown || "").slice(-120),
        },
      })}`,
    );
  }
  const afterResumeDraftRecovery = await waitForSnapshot(
    (current) => current.resume.markdown.includes("E2E 未同步简历恢复验证"),
    "a resume edit made immediately before Panel reload was not recovered into project state",
  );
  assert(
    (afterResumeDraftRecovery.resume.versionId || afterResumeDraftRecovery.resume.id) ===
      (afterManualRevision.resume.versionId || afterManualRevision.resume.id),
    "resume draft recovery forked an unrelated revision instead of resuming the active edit",
  );
  await waitForGuest(
    view,
    `document.querySelector("#project-snapshot-state")?.textContent.includes("已同步")`,
    "the recovered resume draft did not return to a visibly saved project state",
    25_000,
  );
  await execute(view, `document.querySelector("[data-resume-mode='preview']")?.click()`);
  await waitForGuest(
    view,
    `document.querySelector("#resume-version-list")?.textContent.includes("JD REVISION")`,
    "resume history did not label the direct edit as a revision",
  );
  const recoveredTraceCount = await execute(
    view,
    `document.querySelector("#session-activity-count")?.textContent`,
  );
  assert(
    recoveredTraceCount === "1 条",
    `detached review recovery did not retain exactly one auditable Panel Trace: ${String(recoveredTraceCount)}`,
  );
  assert(
    await execute(
      view,
      `document.querySelector("#session-activity-list")?.textContent.includes("已写回评分与项目优化稿")`,
    ),
    "recovered Panel Trace did not retain its completed outcome",
  );
  const externalSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  externalSnapshot.externalE2EMarker = "must-not-be-overwritten";
  externalSnapshot.updatedAt = new Date().toISOString();
  await execute(
    view,
    `document.querySelector('[data-view-target="interviews"]')?.click()`,
  );
  await execute(
    view,
    `document.querySelector('[data-interview-workspace="bank"]')?.click()`,
  );
  await waitForGuest(
    view,
    `document.querySelector("[data-toggle-bank-mastery-id]") != null`,
    "question bank did not expose a delayed write for conflict testing",
  );
  await execute(view, `document.querySelector("[data-toggle-bank-mastery-id]")?.click()`);
  await writeFile(snapshotPath, `${JSON.stringify(externalSnapshot, null, 2)}\n`);
  await waitForGuest(
    view,
    `document.querySelector("#project-sync-conflict")?.hidden === false && document.querySelector("#project-sync-conflict-detail")?.textContent.includes("停止")`,
    "stale Panel state did not surface a project snapshot conflict",
  );
  await waitForGuest(
    view,
    `[...document.querySelectorAll("[data-toggle-bank-mastery-id]")].some((button) => button.textContent.includes("标记已掌握"))`,
    "a failed question-bank write left the optimistic mastery state visible",
  );
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 800));
  const afterConflict = JSON.parse(await readFile(snapshotPath, "utf8"));
  assert(
    afterConflict.externalE2EMarker === "must-not-be-overwritten",
    "a stale Panel overwrote an external project update",
  );
  assert(rendererErrors.length === 0, "renderer reported an uncaught error during Job Hunt E2E");
  console.log("Job Hunt HQ Panel-native Electron E2E: passed");
} finally {
  await app?.close().catch(() => undefined);
  await isolated.cleanup();
}
