import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverProjects } from "./panel-projects.mjs";
import { validatePackage as validateSourcePackage } from "./validation/package.mjs";
import { validateSyntax as validateSourceSyntax } from "./validation/syntax.mjs";
import { runSchemaPatternTests } from "../tests/validation/schema-pattern.test.mjs";
import { runPackageContract as runQuantLabPackageContract } from "../tests/apps/quant-lab/package-contract.test.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = [
  "apps/design-studio",
  "apps/job-hunt-hq",
  "apps/quant-lab",
  "apps/video-download",
  "templates/starter",
];
const forbiddenNames = new Set([
  ".claude-plugin",
  ".codex-plugin",
  ".codeshell-plugin",
  ".mcp.json",
  "agents",
  "commands",
  "hooks",
  "skills",
]);
const allowedExtensions = new Set([
  ".html",
  ".js",
  ".mjs",
  ".md",
  ".css",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
]);
const allowedAgentExtensions = new Set([".md", ".json", ".png", ".jpg", ".jpeg", ".webp"]);
const maxHostSchemaPatternLength = 512;
const maxHostPatternInputLength = 10_000;

// Keep Panel App manifests inside CodeShell's fail-closed regular-expression
// subset. JavaScript can compile a much wider set of patterns than the Host
// intentionally accepts, so package validation must catch this before install.
function isHostSafeSchemaPattern(pattern) {
  if (typeof pattern !== "string" || pattern.length > maxHostSchemaPatternLength) return false;
  let escaped = false;
  let inCharacterClass = false;
  let variableQuantifiers = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (escaped) {
      if (!inCharacterClass && /[1-9k]/u.test(character)) return false;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[" && !inCharacterClass) {
      inCharacterClass = true;
      continue;
    }
    if (character === "]" && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (!inCharacterClass && ["(", ")", "|", "."].includes(character)) return false;
    if (!inCharacterClass && ["*", "+", "?"].includes(character)) {
      variableQuantifiers += 1;
      continue;
    }
    if (!inCharacterClass && character === "{") {
      const closingBrace = pattern.indexOf("}", index + 1);
      if (closingBrace < 0) return false;
      const body = pattern.slice(index + 1, closingBrace);
      const match = /^(\d+)(?:,(\d+))?$/u.exec(body);
      if (!match) return false;
      const minimum = Number(match[1]);
      const maximum = match[2] === undefined ? minimum : Number(match[2]);
      if (
        !Number.isSafeInteger(minimum) ||
        !Number.isSafeInteger(maximum) ||
        minimum > maximum ||
        maximum > maxHostPatternInputLength
      ) {
        return false;
      }
      if (minimum !== maximum) variableQuantifiers += 1;
      index = closingBrace;
      continue;
    }
    if (!inCharacterClass && character === "}") return false;
  }
  if (escaped || inCharacterClass || variableQuantifiers > 1) return false;
  try {
    new RegExp(pattern, "u");
    return true;
  } catch {
    return false;
  }
}

function assertHostSafeSchemaPatterns(schema, packagePath, toolName, path = "arguments") {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema)) {
    schema.forEach((value, index) =>
      assertHostSafeSchemaPatterns(value, packagePath, toolName, `${path}[${index}]`),
    );
    return;
  }
  if (Object.prototype.hasOwnProperty.call(schema, "pattern")) {
    assert(
      isHostSafeSchemaPattern(schema.pattern),
      `${packagePath}: ${toolName} has a Host-incompatible JSON Schema pattern at ${path}`,
    );
  }
  for (const [key, value] of Object.entries(schema)) {
    if (key === "pattern") continue;
    assertHostSafeSchemaPatterns(value, packagePath, toolName, `${path}.${key}`);
  }
}

async function walk(directory, root = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    const info = await lstat(absolute);
    const localPath = relative(root, absolute).split(sep).join("/");
    assert(!info.isSymbolicLink(), `${localPath}: symlinks are not allowed`);
    assert(
      localPath.includes("/") || !forbiddenNames.has(entry.name),
      `${localPath}: Agent Plugin content is not allowed`,
    );
    if (info.isDirectory()) files.push(...(await walk(absolute, root)));
    else {
      assert(info.isFile(), `${localPath}: unsupported file type`);
      files.push(localPath);
    }
  }
  return files;
}

async function validatePackage(packagePath) {
  const root = join(repositoryRoot, packagePath);
  const rootRealPath = await realpath(root);
  const manifestPath = join(root, ".codeshell-panel", "panel.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  assert(
    manifest.schemaVersion === 1 || manifest.schemaVersion === 2,
    `${packagePath}: schemaVersion must be 1 or 2`,
  );
  assert.match(manifest.id, /^[a-z][a-z0-9-]{0,63}$/, `${packagePath}: invalid id`);
  assert.equal(typeof manifest.version, "string", `${packagePath}: version is required`);
  assert.equal(typeof manifest.title?.default, "string", `${packagePath}: title is required`);
  assert.match(manifest.entry, /^app\/[^/].*\.html$/, `${packagePath}: entry must be below app/`);
  assert(Array.isArray(manifest.permissions), `${packagePath}: permissions must be an array`);
  const declaredSkillRoots = new Set();
  if (manifest.schemaVersion === 2 && manifest.agent) {
    assert(Array.isArray(manifest.agent.tools), `${packagePath}: agent.tools must be an array`);
    assert(Array.isArray(manifest.agent.skills), `${packagePath}: agent.skills must be an array`);
    const toolNames = new Set();
    for (const tool of manifest.agent.tools) {
      assert.match(tool.name, /^[a-z][a-z0-9_]{0,63}$/, `${packagePath}: invalid tool name`);
      assert(!toolNames.has(tool.name), `${packagePath}: duplicate tool ${tool.name}`);
      toolNames.add(tool.name);
      assert.equal(typeof tool.description, "string", `${packagePath}: tool description required`);
      assert.equal(tool.inputSchema?.type, "object", `${packagePath}: tool schema must be object`);
      assertHostSafeSchemaPatterns(tool.inputSchema, packagePath, tool.name);
      assert.equal(typeof tool.readOnly, "boolean", `${packagePath}: tool readOnly required`);
    }
    for (const skill of manifest.agent.skills) {
      assert.match(
        skill,
        /^agent\/skills\/[a-z][a-z0-9-]{0,63}\/SKILL\.md$/,
        `${packagePath}: invalid Skill path`,
      );
      const skillInfo = await stat(join(root, ...skill.split("/")));
      assert(skillInfo.isFile(), `${packagePath}: declared Skill is not a file`);
      assert(skillInfo.size <= 256 * 1024, `${packagePath}: declared Skill exceeds 256 KiB`);
      declaredSkillRoots.add(skill.slice(0, -"/SKILL.md".length));
    }
  }

  const entry = resolve(root, ...manifest.entry.split("/"));
  const entryRealPath = await realpath(entry);
  assert(
    entryRealPath.startsWith(`${rootRealPath}${sep}`),
    `${packagePath}: entry escapes its package`,
  );
  assert((await stat(entryRealPath)).isFile(), `${packagePath}: entry is not a file`);

  const files = await walk(root);
  for (const file of files) {
    if (file === ".codeshell-panel/panel.json" || file === "README.md" || file === "LICENSE") {
      continue;
    }
    const declaredAgentAsset = [...declaredSkillRoots].some(
      (skillRoot) => file === skillRoot || file.startsWith(`${skillRoot}/`),
    );
    assert(
      file.startsWith("app/") || declaredAgentAsset,
      `${packagePath}/${file}: assets must live under app/ or a declared Skill`,
    );
    assert(
      (declaredAgentAsset ? allowedAgentExtensions : allowedExtensions).has(
        extname(file).toLowerCase(),
      ),
      `${packagePath}/${file}: unsupported asset extension`,
    );
  }

  const html = await readFile(entry, "utf8");
  assert(
    !/<script(?![^>]*\bsrc=)[^>]*>/i.test(html),
    `${packagePath}: inline scripts are not allowed`,
  );
  if (manifest.id === "design-studio") {
    const appScript = await readFile(join(root, "app", "app.js"), "utf8");
    const toolNames = new Set(manifest.agent.tools.map((tool) => tool.name));
    const registeredToolNames = new Set(
      [...appScript.matchAll(/register\(\s*"([a-z][a-z0-9_]*)"/g)].map((match) => match[1]),
    );
    const queriedIds = [...appScript.matchAll(/document\.querySelector\("#([a-z0-9-]+)"\)/g)].map(
      (match) => match[1],
    );
    assert.equal(manifest.version, "0.18.1", `${packagePath}: responsive-layout version mismatch`);
    assert.deepEqual(
      [...registeredToolNames].sort(),
      [...toolNames].sort(),
      `${packagePath}: manifest tools and registered handlers must match`,
    );
    for (const id of queriedIds) {
      assert.match(html, new RegExp(`id="${id}"`), `${packagePath}: missing #${id}`);
    }
    for (const toolName of ["read_product_brief", "generate_frontend", "compare_frontend"]) {
      assert(toolNames.has(toolName), `${packagePath}: ${toolName} tool is required`);
    }
    assert.match(html, /id="repo-files-tab-button"/, `${packagePath}: file tab is required`);
    assert.match(html, /id="repo-files-list"/, `${packagePath}: file list is required`);
    assert.match(html, /id="refresh-repo-files"/, `${packagePath}: file refresh is required`);
    assert.match(
      appScript,
      /refreshRepoFilesPanel/,
      `${packagePath}: file inventory refresh is required`,
    );
    assert.match(
      appScript,
      /renderDesignFileRows/,
      `${packagePath}: shared file rendering is required`,
    );
    assert.match(html, /id="sidebar-pages-list"/, `${packagePath}: persistent pages are required`);
    assert.match(html, /id="delivery-tab"/, `${packagePath}: delivery workflow is required`);
  }
  if (manifest.id === "quant-lab") {
    await runQuantLabPackageContract({ root, manifest, html, packagePath });
  }
  if (manifest.id === "job-hunt-hq") {
    const appScript = await readFile(join(root, "app", "app.js"), "utf8");
    const { resolveCandidateSourceReadiness } = await import(
      pathToFileURL(join(root, "app", "source-readiness-model.mjs")).href
    );
    const {
      aggregateKeywordFrequency,
      inProgressMocksDroppedByHistoryRotation,
      inProgressMocksOrphanedBySetRotation,
      interviewSetJobIds,
      interviewSetScope,
      prioritizeInterviewSetRotation,
      prioritizeMockSessionHistory,
      resolveInterviewGenerationJobs,
    } = await import(pathToFileURL(join(root, "app", "interview-generation-model.mjs")).href);
    const {
      QUESTION_BANK_LIMIT,
      canonicalizeMockSessionQuestionIds,
      inferInterviewQuestionCompetency,
      inferInterviewQuestionType,
      interviewPracticeQueue,
      interviewQuestionLearningSchedule,
      interviewQuestionFingerprint,
      interviewBankQuestionsFromDebrief,
      latestQuestionPracticeAttempt,
      latestQuestionPracticeReview,
      mockSessionProgress,
      mockSessionReviewTargetError,
      mockSessionScoreSummary,
      normalizeMockSessionScoreSummary,
      normalizeInterviewQuestionSourceRefs,
      resolveMockSessionScoreSummary,
      normalizeInterviewLibrary,
      questionBankCurationGaps,
      questionBankPage,
      questionBankStats,
      questionNeedsWork,
      repairableInterviewQuestions,
      resumableMockSessions,
      syncInterviewSetsFromBank,
      updateInterviewBankQuestion,
    } = await import(pathToFileURL(join(root, "app", "interview-bank-model.mjs")).href);
    const {
      buildInterviewFollowUpDraft,
      buildInterviewQuestionPracticeHistory,
      buildInterviewTrainingInsights,
    } = await import(pathToFileURL(join(root, "app", "interview-analytics-model.mjs")).href);
    const {
      estimateInterviewSpeech,
      interviewAnswerGuide,
      normalizeInterviewAnswerDraft,
      resolveInterviewAnswerDraft,
    } = await import(pathToFileURL(join(root, "app", "interview-practice-model.mjs")).href);
    const {
      PROJECT_SNAPSHOT_SAFE_BYTES,
      PROJECT_SNAPSHOT_MAX_SHARDS,
      PROJECT_SNAPSHOT_WRITE_LIMIT_BYTES,
      compactProjectSnapshotPayload,
      hydrateProjectSnapshotDocuments,
      nextSnapshotShardGeneration,
      prepareProjectSnapshotDocuments,
      projectSnapshotSemanticKey,
      projectSnapshotShardDescriptors,
      projectSnapshotStorageNeedsMigration,
      projectSnapshotsSemanticallyEqual,
      snapshotJsonBytes,
    } = await import(pathToFileURL(join(root, "app", "snapshot-sharding-model.mjs")).href);
    const {
      INTERVIEW_CONTEXT_MAX_BYTES,
      INTERVIEW_PRACTICE_CONTEXT_MAX_BYTES,
      JOB_SEARCH_CONTEXT_MAX_BYTES,
      buildJobSearchContext,
      jobSearchContextJsonBytes,
    } = await import(pathToFileURL(join(root, "app", "job-search-context-model.mjs")).href);
    const skill = await readFile(
      join(root, "agent", "skills", "job-hunt-workflow", "SKILL.md"),
      "utf8",
    );
    const workflowReference = await readFile(
      join(root, "agent", "skills", "job-hunt-workflow", "references", "workflows.md"),
      "utf8",
    );
    const channelLoginReference = await readFile(
      join(root, "agent", "skills", "job-hunt-workflow", "references", "channel-login.md"),
      "utf8",
    );
    const snapshotSchema = JSON.parse(
      await readFile(join(root, "app", "formats", "job-hunt-panel-v2.schema.json"), "utf8"),
    );
    const toolNames = new Set(manifest.agent.tools.map((tool) => tool.name));
    const registeredToolNames = new Set(
      [...appScript.matchAll(/register\(\s*"([a-z][a-z0-9_]*)"/g)].map((match) => match[1]),
    );
    const queriedIds = [...appScript.matchAll(/document\.querySelector\("#([a-z0-9-]+)"\)/g)].map(
      (match) => match[1],
    );
    assert.equal(manifest.version, "4.1.1", `${packagePath}: guided workflow version mismatch`);
    for (const id of ["view-today", "view-dashboard", "view-resumes", "view-interviews", "view-materials"]) {
      assert.match(html, new RegExp(`id="${id}"`), `${packagePath}: missing v4 primary workspace ${id}`);
    }
    for (const mode of ["content", "versions", "files"]) {
      assert.match(
        html,
        new RegExp(`data-resume-workspace="${mode}"`),
        `${packagePath}: missing resume workspace ${mode}`,
      );
    }
    for (const mode of ["practice", "bank", "history"]) {
      assert.match(
        html,
        new RegExp(`data-interview-workspace="${mode}"`),
        `${packagePath}: missing interview workspace ${mode}`,
      );
    }
    for (const mode of ["profile", "evidence", "sync"]) {
      assert.match(
        html,
        new RegExp(`data-data-workspace="${mode}"`),
        `${packagePath}: missing data workspace ${mode}`,
      );
    }
    assert.match(html, /id="view-job-inbox"/, `${packagePath}: JD inbox needs its own workspace`);
    assert.match(html, /id="open-interview-generator"/, `${packagePath}: question bank needs one set generator entry`);
    assert.equal(PROJECT_SNAPSHOT_WRITE_LIMIT_BYTES, 384 * 1024);
    assert(PROJECT_SNAPSHOT_SAFE_BYTES < PROJECT_SNAPSHOT_WRITE_LIMIT_BYTES);
    assert(
      manifest.permissions.includes("credentials.cookies"),
      `${packagePath}: channel login needs the host-owned Cookie permission`,
    );
    assert(
      manifest.permissions.includes("automations.manage"),
      `${packagePath}: scheduled discovery needs project-scoped automation permission`,
    );
    assert(
      manifest.permissions.includes("audio.transcribe"),
      `${packagePath}: in-panel voice answers need reviewed transcription permission`,
    );
    assert.deepEqual(
      [...registeredToolNames].sort(),
      [...toolNames].sort(),
      `${packagePath}: manifest tools and registered handlers must match`,
    );
    for (const id of queriedIds) {
      assert.match(html, new RegExp(`id="${id}"`), `${packagePath}: missing #${id}`);
    }
    for (const id of [
      "source-readiness-score",
      "source-readiness-progress",
      "source-readiness-signals",
      "source-gap-list",
      "complete-source-gaps",
      "project-sync-conflict",
      "review-project-conflict",
      "reload-project-conflict",
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `${packagePath}: missing #${id}`);
    }
    for (const id of [
      "panel-interview-stage",
      "panel-interview-question",
      "panel-interview-answer",
      "panel-interview-mic",
      "submit-panel-interview-answer",
      "panel-interview-feedback",
      "panel-interview-next-question",
      "interview-readiness-questions",
      "interview-readiness-voice",
      "interview-readiness-score",
      "recheck-interview-readiness",
      "test-interview-microphone",
      "interview-training-insights",
      "interview-dimension-list",
      "interview-competency-list",
      "retry-latest-interview-question",
      "practice-latest-interview-follow-up",
      "panel-interview-follow-up",
      "save-panel-interview-follow-up",
      "practice-panel-interview-follow-up",
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `${packagePath}: missing #${id}`);
    }
    assert.match(
      appScript,
      /startPanelInterview\(\{[\s\S]*questionIds: practiceableQuestionIds,[\s\S]*mockSessionId,/,
      `${packagePath}: full mocks must start in the Panel interview stage`,
    );
    assert.match(
      appScript,
      /hostCall\("audio\.transcribe", \{[\s\S]*language:/,
      `${packagePath}: microphone recordings must use the reviewed Host transcription call`,
    );
    assert.match(
      appScript,
      /renderInterviewReadiness\(\)[\s\S]*每次评分都精确绑定题目和这一次已保存回答，不会评到旧答案/,
      `${packagePath}: practice readiness must explain question, voice, and exact score write-back state`,
    );
    assert.match(
      appScript,
      /panelInterviewScoreAnswer\.disabled\s*=\s*[\s\S]{0,160}hasUnsavedAnswer[\s\S]{0,240}panelInterviewNextQuestion\.disabled\s*=\s*stage\.saving\s*\|\|\s*hasUnsavedAnswer/,
      `${packagePath}: unsaved interview edits must block scoring and navigation`,
    );
    assert.match(
      appScript,
      /probePanelAudioAvailability\(\{ force = false \} = \{\}\)/,
      `${packagePath}: interview home must support an explicit audio readiness recheck`,
    );
    assert.match(
      appScript,
      /testPanelMicrophoneAccess\(\)[\s\S]*audio\.requestMicrophoneAccess[\s\S]*getUserMedia/,
      `${packagePath}: microphone readiness must be testable before an interview starts`,
    );
    assert.match(
      appScript,
      /panelInterviewScoreTrace\([\s\S]*scorePending[\s\S]*评分任务已精确绑定当前题目和这次回答/,
      `${packagePath}: the active question must expose pending and retryable score write-back state`,
    );
    assert.match(
      appScript,
      /buildInterviewTrainingInsights\(state\.questionBank\)[\s\S]*weakestDimension|buildInterviewTrainingInsights\(state\.questionBank\)[\s\S]*interviewDimensionList/,
      `${packagePath}: scored practice must produce a visible competency and rubric trend`,
    );
    assert.match(
      appScript,
      /saveOrPracticeInterviewFollowUp\([\s\S]*buildInterviewFollowUpDraft[\s\S]*writeProjectSnapshot/,
      `${packagePath}: dynamic follow-ups must require an explicit save or practice action`,
    );
    assert.match(
      appScript,
      /question\.practiceAttempts = \[[\s\S]*?await writeProjectSnapshot\(\)/,
      `${packagePath}: candidate answers must persist from the Panel without crossing a model boundary`,
    );
    for (const id of [
      "research-job-select",
      "run-company-research",
      "research-go-job-pool",
      "research-report-list",
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `${packagePath}: missing #${id}`);
    }
    assert.match(
      appScript,
      /researchReportList\.addEventListener\("click"/,
      `${packagePath}: saved research reports must be clickable`,
    );
    assert.match(
      html,
      /direct-action-note">直接保存 · 不调用 Agent</,
      `${packagePath}: deterministic triage actions must be explicit`,
    );
    assert.match(
      appScript,
      /jobDetailInterest\.disabled = !job;/,
      `${packagePath}: marking a job as interesting must not wait for the Agent`,
    );
    assert(
      html.indexOf('id="view-dashboard"') < html.indexOf('id="jd-inbox-panel"') &&
        html.indexOf('id="jd-inbox-panel"') < html.indexOf('id="view-materials"'),
      `${packagePath}: JD inbox belongs to the job pool, not candidate sources`,
    );
    assert.doesNotMatch(
      html,
      /materials-source-overview-slot|source-channel-entry/,
      `${packagePath}: candidate sources must not depend on job-channel UI`,
    );
    const completeSources = resolveCandidateSourceReadiness({
      workspace: "/career",
      hasCodeshellFile: true,
      hasSnapshot: true,
      profile: {
        name: "Candidate",
        role: "AI Product Engineer",
        contact: "candidate@example.com",
        summary: "Builds evidence-backed products.",
      },
      experiences: [{ company: "Example", role: "Engineer", achievements: ["Shipped a product"] }],
      repositories: [{ name: "career-app", summary: "Owned the workflow", path: "/career-app" }],
      baseResumeCount: 1,
    });
    assert.equal(completeSources.score, 100, `${packagePath}: complete source score mismatch`);
    assert.equal(completeSources.gaps.length, 0, `${packagePath}: complete sources show gaps`);
    const incompleteSources = resolveCandidateSourceReadiness({
      workspace: "/career",
      hasCodeshellFile: true,
      hasSnapshot: true,
      profile: { name: "Candidate", role: "Engineer" },
    });
    assert(
      incompleteSources.gaps.some((gap) => gap.id === "experience") &&
        incompleteSources.gaps.some((gap) => gap.id === "evidence") &&
        incompleteSources.gaps.some((gap) => gap.id === "base"),
      `${packagePath}: source readiness must expose actionable evidence gaps`,
    );
    for (const id of [
      "edit-candidate-profile",
      "cancel-candidate-profile",
      "save-candidate-profile",
      "candidate-profile-note",
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `${packagePath}: missing #${id}`);
    }
    assert.match(
      appScript,
      /async function saveCandidateProfileEdit\(\)[\s\S]*touchResumePresentation\(\{ allVersions: true \}\)[\s\S]*await writeProjectSnapshot\(\)[\s\S]*state\.profile = previous\.profile/,
      `${packagePath}: direct profile edits must be transactional and invalidate stale resume exports`,
    );
    for (const id of [
      "generate-single-interview",
      "generate-aggregate-interview",
      "interview-single-job-select",
      "interview-aggregate-job-picker",
      "interview-candidate-source-summary",
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `${packagePath}: missing #${id}`);
    }
    const interviewJobs = [
      { id: "job-a", title: "AI Frontend" },
      { id: "job-b", title: "Agent UI" },
      { id: "job-c", title: "Developer Tools" },
    ];
    assert.deepEqual(
      resolveInterviewGenerationJobs({
        scope: "aggregate",
        jobs: interviewJobs,
        selectedJobIds: ["job-b", "job-a"],
      }).map((job) => job.id),
      ["job-b", "job-a"],
      `${packagePath}: aggregate JD selection mismatch`,
    );
    const aggregateSet = { sourceMode: "aggregate", jobIds: ["job-a", "job-b"] };
    assert.equal(interviewSetScope(aggregateSet), "aggregate");
    assert.deepEqual(interviewSetJobIds(aggregateSet), ["job-a", "job-b"]);
    assert.deepEqual(
      aggregateKeywordFrequency(interviewJobs, (job) =>
        job.id === "job-c" ? ["React"] : ["React", "AI Agent"],
      )[0],
      { keyword: "React", count: 3 },
      `${packagePath}: aggregate hiring-signal frequency mismatch`,
    );
    const rotationSets = Array.from({ length: 20 }, (_, index) => ({
      id: `rotation-${index}`,
    }));
    const activeRotationSession = {
      id: "mock-keep",
      interviewSetId: "rotation-19",
      status: "in_progress",
    };
    const prioritizedRotation = prioritizeInterviewSetRotation(
      { id: "rotation-new" },
      rotationSets,
      [activeRotationSession],
    );
    assert.equal(prioritizedRotation[0].id, "rotation-new");
    assert.equal(prioritizedRotation[1].id, "rotation-19");
    assert.deepEqual(
      inProgressMocksOrphanedBySetRotation(
        [activeRotationSession],
        rotationSets,
        prioritizedRotation.slice(0, 20),
      ),
      [],
      `${packagePath}: practice-set rotation must preserve resumable mocks before inactive sets`,
    );
    assert.deepEqual(
      inProgressMocksOrphanedBySetRotation(
        [activeRotationSession],
        rotationSets,
        rotationSets.slice(0, 19),
      ),
      ["mock-keep"],
    );
    const migrationSets = Array.from({ length: 21 }, (_, index) => ({
      id: `migration-${index}`,
    }));
    assert(
      prioritizeInterviewSetRotation(null, migrationSets, [
        {
          id: "mock-migration-active",
          interviewSetId: "migration-20",
          status: "in_progress",
        },
      ])
        .slice(0, 20)
        .some((set) => set.id === "migration-20"),
      `${packagePath}: snapshot migration must retain sets used by active mocks`,
    );
    const mockHistory = Array.from({ length: 80 }, (_, index) => ({
      id: `history-${index}`,
      status: index === 79 ? "in_progress" : "completed",
    }));
    const prioritizedMockHistory = prioritizeMockSessionHistory(
      { id: "history-new", status: "in_progress" },
      mockHistory,
    );
    assert.equal(prioritizedMockHistory.length, 80);
    assert.deepEqual(
      prioritizedMockHistory.slice(0, 2).map((session) => session.id),
      ["history-new", "history-79"],
    );
    assert.deepEqual(
      inProgressMocksDroppedByHistoryRotation(mockHistory, prioritizedMockHistory),
      [],
      `${packagePath}: bounded mock history must evict a terminal event before an active one`,
    );
    const migrationSessions = Array.from({ length: 81 }, (_, index) => ({
      id: `migration-history-${index}`,
      status: index === 80 ? "in_progress" : "completed",
    }));
    assert(
      prioritizeMockSessionHistory(null, migrationSessions).some(
        (session) => session.id === "migration-history-80",
      ),
      `${packagePath}: snapshot migration must retain active mock history`,
    );
    const saturatedActiveHistory = mockHistory.map((session) => ({
      ...session,
      status: "in_progress",
    }));
    assert.equal(
      inProgressMocksDroppedByHistoryRotation(
        saturatedActiveHistory,
        prioritizeMockSessionHistory(
          { id: "history-new", status: "in_progress" },
          saturatedActiveHistory,
        ),
      ).length,
      1,
      `${packagePath}: an all-active history must block a new mock instead of losing one`,
    );
    const migratedInterviewLibrary = normalizeInterviewLibrary(
      [],
      [
        {
          id: "set-a",
          jobId: "job-a",
          questions: [
            {
              id: "legacy-question-a",
              question: "Tell me about a difficult architecture trade-off.",
              category: "System design",
              evidenceRefs: ["file:architecture.md"],
              answerPoints: ["Context", "Decision", "Result"],
              recommendedAnswer: "I would ground this in the verified project decision.",
              followUps: ["What would you change now?"],
            },
          ],
        },
        {
          id: "set-b",
          jobId: "job-b",
          questions: [
            {
              id: "legacy-question-b",
              question: "Tell me about a difficult architecture trade off",
              category: "System design",
              evidenceRefs: ["commit:abc1234"],
              answerPoints: ["Context", "Decision", "Result"],
              recommendedAnswer: "Duplicate generated draft must not replace the first.",
              followUps: ["How did you validate it?"],
            },
          ],
        },
      ],
      { now: "2026-08-09T00:00:00.000Z" },
    );
    assert.equal(
      migratedInterviewLibrary.questionBank.length,
      1,
      `${packagePath}: equivalent legacy questions must migrate into one bank item`,
    );
    assert.equal(
      migratedInterviewLibrary.interviewSets[0].questions[0].bankQuestionId,
      migratedInterviewLibrary.interviewSets[1].questions[0].bankQuestionId,
      `${packagePath}: practice sets must reference the same canonical question`,
    );
    assert.deepEqual(migratedInterviewLibrary.questionBank[0].jobIds, ["job-a", "job-b"]);
    assert.deepEqual(migratedInterviewLibrary.questionBank[0].sourceSetIds, ["set-a", "set-b"]);
    assert.deepEqual(
      Object.keys(migratedInterviewLibrary.interviewSets[0]).sort(),
      [
        "createdAt",
        "difficulty",
        "id",
        "jobId",
        "jobIds",
        "mode",
        "questions",
        "sourceMode",
        "title",
      ].sort(),
      `${packagePath}: migrated practice sets must use the strict v2 shape`,
    );
    assert(migratedInterviewLibrary.interviewSets[0].questions[0].bankQuestionId);
    assert.deepEqual(
      migratedInterviewLibrary.interviewSets[0].questions[0].sourceRefs,
      migratedInterviewLibrary.interviewSets[0].questions[0].evidenceRefs,
    );
    assert.deepEqual(questionBankStats(migratedInterviewLibrary.questionBank), {
      total: 1,
      inbox: 1,
      ready: 0,
      mastered: 0,
      practiced: 0,
      needsWork: 0,
    });
    assert.equal(
      migratedInterviewLibrary.questionBank[0].status,
      "inbox",
      `${packagePath}: incomplete legacy questions must pass through the curation inbox`,
    );
    assert.deepEqual(
      questionBankCurationGaps({
        question: "How did you resolve the incident?",
        category: "待分类",
        competency: "",
        sourceRefs: [],
      }),
      ["分类", "评估能力", "Source"],
    );
    assert.deepEqual(
      questionBankCurationGaps({
        question: "How did you resolve the incident?",
        category: "Reliability",
        competency: "Incident ownership",
        sourceRefs: ["session:current"],
      }),
      [],
    );
    assert.match(
      inferInterviewQuestionCompetency({ category: "RAG 调优", type: "technical" }),
      /RAG 调优.*技术原理/,
    );
    const repairableLegacyQuestions = repairableInterviewQuestions([
      {
        id: "legacy-repairable",
        question: "RAG 答案错误但召回正确时，你会如何定位？",
        category: "RAG 调优",
        competency: "",
        type: "technical",
        status: "inbox",
        sourceRefs: ["user:test"],
      },
      {
        id: "legacy-missing-source",
        question: "你会如何设计一个可恢复的 Agent 工作流？",
        category: "系统设计",
        competency: "",
        type: "system_design",
        status: "inbox",
        sourceRefs: [],
      },
    ]);
    assert.equal(repairableLegacyQuestions.length, 1);
    assert.equal(repairableLegacyQuestions[0].question.id, "legacy-repairable");
    const practiceQueue = interviewPracticeQueue(
      [
        {
          id: "new-high",
          status: "ready",
          priority: "high",
          practiceAttempts: [],
          practiceReviews: [],
        },
        {
          id: "weak-medium",
          status: "ready",
          priority: "medium",
          practiceAttempts: [{ id: "attempt-weak", answer: "answer" }],
          practiceReviews: [{ id: "review-weak", overallScore: 52 }],
        },
        {
          id: "mastered-high",
          status: "mastered",
          priority: "high",
          practiceAttempts: [{ id: "attempt-mastered", answer: "answer" }],
          practiceReviews: [{ id: "review-mastered", overallScore: 92 }],
        },
      ],
      { limit: 3 },
    );
    assert.deepEqual(
      practiceQueue.map((entry) => entry.question.id),
      ["weak-medium", "new-high", "mastered-high"],
    );
    const weakReviewSchedule = interviewQuestionLearningSchedule(
      {
        status: "ready",
        practiceAttempts: [
          {
            id: "attempt-scheduled-weak",
            answer: "answer",
            updatedAt: "2026-08-09T08:00:00.000Z",
          },
        ],
        practiceReviews: [
          {
            id: "review-scheduled-weak",
            overallScore: 55,
            createdAt: "2026-08-09T08:00:00.000Z",
          },
        ],
      },
      { now: "2026-08-11T08:00:00.000Z" },
    );
    assert.equal(weakReviewSchedule.state, "weak");
    assert.equal(weakReviewSchedule.intervalDays, 1);
    assert.equal(weakReviewSchedule.due, true);
    const strongReviewSchedule = interviewQuestionLearningSchedule(
      {
        status: "mastered",
        practiceAttempts: [
          {
            id: "attempt-scheduled-strong",
            answer: "answer",
            updatedAt: "2026-08-10T08:00:00.000Z",
          },
        ],
        practiceReviews: [
          {
            id: "review-scheduled-strong",
            overallScore: 92,
            createdAt: "2026-08-10T08:00:00.000Z",
          },
        ],
      },
      { now: "2026-08-11T08:00:00.000Z" },
    );
    assert.equal(strongReviewSchedule.state, "strong");
    assert.equal(strongReviewSchedule.intervalDays, 10);
    assert.equal(strongReviewSchedule.due, false);
    assert.equal(strongReviewSchedule.daysUntilReview, 9);
    assert.deepEqual(interviewAnswerGuide({ type: "project_deep_dive" }).steps, [
      "背景：模块为什么难",
      "职责：你负责哪一段",
      "决策：难点、取舍与方案",
      "验证：结果如何确认",
    ]);
    const oneMinuteSpeech = estimateInterviewSpeech("测".repeat(220));
    assert.equal(oneMinuteSpeech.seconds, 60);
    assert.equal(oneMinuteSpeech.state, "target");
    const restoredDraft = resolveInterviewAnswerDraft(
      normalizeInterviewAnswerDraft({
        questionId: "bank-draft",
        practiceSessionId: "mock-draft",
        answer: "尚未提交、但应在重开后恢复的回答草稿。",
        inputMode: "mixed",
        updatedAt: "2026-08-11T10:01:00.000Z",
      }),
      { id: "bank-draft" },
      {
        answer: "更早保存的回答。",
        inputMode: "typed",
        updatedAt: "2026-08-11T10:00:00.000Z",
      },
      { practiceSessionId: "mock-draft" },
    );
    assert.equal(restoredDraft.restored, true);
    assert.equal(restoredDraft.inputMode, "mixed");
    const practiceHistory = buildInterviewQuestionPracticeHistory({
      practiceAttempts: [
        {
          id: "attempt-history-2",
          answer: "Second answer",
          inputMode: "mixed",
          updatedAt: "2026-02-01T00:00:00.000Z",
        },
        {
          id: "attempt-history-1",
          answer: "First answer",
          inputMode: "typed",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      practiceReviews: [
        {
          id: "review-history-2-new",
          practiceAttemptId: "attempt-history-2",
          overallScore: 82,
          createdAt: "2026-02-03T00:00:00.000Z",
        },
        {
          id: "review-history-2-old",
          practiceAttemptId: "attempt-history-2",
          overallScore: 75,
          createdAt: "2026-02-02T00:00:00.000Z",
        },
        {
          id: "review-history-1",
          practiceAttemptId: "attempt-history-1",
          overallScore: 60,
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });
    assert.equal(practiceHistory[0].attemptId, "attempt-history-2");
    assert.equal(practiceHistory[0].sequence, 2);
    assert.equal(practiceHistory[0].score, 82);
    assert.equal(practiceHistory[0].delta, 22);
    assert.equal(practiceHistory[1].score, 60);
    const trainingInsights = buildInterviewTrainingInsights([
      {
        id: "competency-strong",
        status: "ready",
        question: "How do you make tool calls idempotent?",
        competency: "可靠性设计",
        practiceAttempts: [{ id: "attempt-a", answer: "Use an idempotency key." }],
        practiceReviews: [
          {
            id: "review-a-current",
            overallScore: 80,
            dimensions: { evidence: 90, structure: 80, depth: 70, relevance: 80 },
            followUp: "How do you prove that a retry did not repeat an external side effect?",
            createdAt: "2026-02-02T00:00:00.000Z",
          },
          {
            id: "review-a-previous",
            overallScore: 60,
            dimensions: { evidence: 50, structure: 60, depth: 70, relevance: 60 },
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      {
        id: "competency-weak",
        status: "ready",
        question: "Describe your personal contribution to the project.",
        competency: "个人贡献表达",
        practiceAttempts: [{ id: "attempt-b", answer: "I worked on it." }],
        practiceReviews: [
          {
            id: "review-b-current",
            practiceAttemptId: "attempt-b",
            overallScore: 40,
            dimensions: { evidence: 20, structure: 50, depth: 30, relevance: 60 },
            improvements: ["Name the exact module and personal decision."],
            followUp: "Which exact module did you own, and how did you validate the outcome?",
            createdAt: "2026-03-03T00:00:00.000Z",
          },
        ],
      },
    ]);
    assert.equal(trainingInsights.reviewedQuestionCount, 2);
    assert.equal(trainingInsights.reviewCount, 3);
    assert.equal(trainingInsights.averageScore, 60);
    assert.equal(trainingInsights.previousAverageScore, 60);
    assert.equal(trainingInsights.trendDelta, 0);
    assert.equal(trainingInsights.weakestDimension.key, "depth");
    assert.equal(trainingInsights.weakestDimension.average, 50);
    assert.equal(trainingInsights.competencies[0].name, "个人贡献表达");
    assert.equal(trainingInsights.competencies[0].status, "weak");
    assert.equal(trainingInsights.latestFeedback.bankQuestionId, "competency-weak");
    const followUpDraft = buildInterviewFollowUpDraft(
      {
        id: "competency-weak",
        question: "Describe your personal contribution to the project.",
        category: "项目深挖",
        competency: "个人贡献表达",
        type: "project_deep_dive",
        sourceRefs: ["commit:abc123"],
        tags: ["Agent"],
      },
      {
        id: "review-b-current",
        followUp: "Which exact module did you own, and how did you validate the outcome?",
      },
      { status: "ready", now: "2026-03-03T01:00:00.000Z" },
    );
    assert.equal(followUpDraft.status, "ready");
    assert.equal(followUpDraft.competency, "个人贡献表达");
    assert(followUpDraft.sourceRefs.includes("practice-review:review-b-current"));
    assert(followUpDraft.sourceRefs.includes("question:competency-weak"));
    assert(followUpDraft.sourceRefs.includes("commit:abc123"));
    assert.deepEqual(
      resumableMockSessions([
        {
          id: "empty-session",
          status: "in_progress",
          questionIds: ["one", "two"],
          answeredQuestionIds: [],
        },
        {
          id: "resume-session",
          status: "in_progress",
          questionIds: ["one", "two"],
          answeredQuestionIds: ["one"],
          startedAt: "2026-08-11T08:00:00.000Z",
        },
      ]).map((session) => session.id),
      ["resume-session"],
    );
    assert.equal(
      normalizeInterviewLibrary(
        [
          {
            id: "session-cannot-self-publish",
            question: "How did this question appear in the interview session?",
            category: "Session import",
            competency: "Source interpretation",
            sourceRefs: ["session:current"],
            origin: "session",
            status: "ready",
          },
        ],
        [],
      ).questionBank[0].status,
      "inbox",
      `${packagePath}: Session imports must always require an explicit user curation transition`,
    );
    const reviewedSessionQuestion = normalizeInterviewLibrary(
      [
        {
          id: "session-reviewed-by-user",
          question: "How did this question appear in the interview session?",
          category: "Session import",
          competency: "Source interpretation",
          sourceRefs: ["session:current"],
          origin: "session",
          status: "ready",
        },
      ],
      [],
    ).questionBank;
    assert.equal(
      updateInterviewBankQuestion(reviewedSessionQuestion, "session-reviewed-by-user", {
        origin: "manual",
        status: "ready",
      }).updated.status,
      "ready",
      `${packagePath}: an explicit user confirmation must release a complete inbox item to practice`,
    );
    assert.equal(
      normalizeInterviewLibrary(
        [
          {
            id: "legacy-incomplete-ready",
            question: "How did you resolve a production incident?",
            category: "待分类",
            competency: "",
            sourceRefs: [],
            status: "ready",
          },
        ],
        [],
      ).questionBank[0].status,
      "inbox",
      `${packagePath}: an incomplete legacy ready item must migrate back through curation`,
    );
    const largeQuestionBank = Array.from({ length: 125 }, (_, index) => ({ id: `q-${index}` }));
    assert.deepEqual(questionBankPage(largeQuestionBank, 60), {
      items: largeQuestionBank.slice(0, 60),
      shownCount: 60,
      totalCount: 125,
      remainingCount: 65,
      hasMore: true,
    });
    assert.deepEqual(questionBankPage(largeQuestionBank, 120), {
      items: largeQuestionBank.slice(0, 120),
      shownCount: 120,
      totalCount: 125,
      remainingCount: 5,
      hasMore: true,
    });
    assert.equal(QUESTION_BANK_LIMIT, 600);
    assert.equal(questionBankPage(largeQuestionBank, QUESTION_BANK_LIMIT).hasMore, false);
    const reusedLocalIds = normalizeInterviewLibrary(
      [],
      [
        {
          id: "set-local-a",
          questions: [
            {
              id: "q1",
              question: "How would you recover an interrupted workflow?",
              category: "Reliability",
            },
          ],
        },
        {
          id: "set-local-b",
          questions: [
            {
              id: "q1",
              question: "How would you diagnose a slow React render?",
              category: "Performance",
            },
          ],
        },
      ],
      { now: "2026-08-09T00:00:00.000Z" },
    );
    assert.equal(
      reusedLocalIds.questionBank.length,
      2,
      `${packagePath}: set-local IDs reused across sets must not merge unrelated questions`,
    );
    assert.equal(reusedLocalIds.interviewSets[0].questions[0].id, "q1");
    assert.equal(reusedLocalIds.interviewSets[1].questions[0].id, "q1");
    assert.notEqual(
      reusedLocalIds.interviewSets[0].questions[0].bankQuestionId,
      reusedLocalIds.interviewSets[1].questions[0].bankQuestionId,
    );
    const scopedLegacySession = canonicalizeMockSessionQuestionIds(
      {
        interviewSetId: "set-local-a",
        questionIds: ["q1"],
        reviewedQuestionIds: ["q1", "not-in-session"],
      },
      reusedLocalIds.interviewSets,
      reusedLocalIds.questionBank,
    );
    assert.deepEqual(scopedLegacySession.questionIds, [
      reusedLocalIds.interviewSets[0].questions[0].bankQuestionId,
    ]);
    assert.deepEqual(scopedLegacySession.answeredQuestionIds, scopedLegacySession.questionIds);
    assert.deepEqual(scopedLegacySession.reviewedQuestionIds, scopedLegacySession.questionIds);
    assert.deepEqual(
      canonicalizeMockSessionQuestionIds(
        { questionIds: ["q1"], reviewedQuestionIds: ["q1"] },
        reusedLocalIds.interviewSets,
        reusedLocalIds.questionBank,
      ),
      { questionIds: [], answeredQuestionIds: [], reviewedQuestionIds: [] },
      `${packagePath}: an ambiguous legacy local ID must never attach to an arbitrary question`,
    );
    const worstCaseLegacySets = Array.from({ length: 20 }, (_, setIndex) => ({
      id: `legacy-full-${setIndex}`,
      questions: Array.from({ length: 30 }, (_, questionIndex) => ({
        id: `legacy-local-${questionIndex}`,
        question: `Unique legacy migration question ${setIndex}-${questionIndex}`,
        category: "Legacy migration",
        competency: "Historical evidence",
        evidenceRefs: [`legacy:set-${setIndex}`],
      })),
    }));
    const worstCaseLegacyLibrary = normalizeInterviewLibrary([], worstCaseLegacySets, {
      now: "2026-08-09T00:00:00.000Z",
    });
    assert.equal(
      worstCaseLegacyLibrary.questionBank.length,
      QUESTION_BANK_LIMIT,
      `${packagePath}: the worst-case v1 library must migrate without question loss`,
    );
    assert(
      worstCaseLegacyLibrary.interviewSets.every((set) => set.questions.length === 30),
      `${packagePath}: the worst-case v1 sets must keep all local question links`,
    );
    const oversizedLegacySnapshot = {
      schemaVersion: 2,
      updatedAt: "2026-08-09T00:00:00.000Z",
      profile: {},
      jobs: [],
      repos: [],
      experiences: [],
      jobResearch: [],
      workflowRuns: [],
      resume: {},
      versions: [],
      questionBank: worstCaseLegacyLibrary.questionBank,
      interviewSets: worstCaseLegacyLibrary.interviewSets,
      mockInterviewSessions: [],
      preparationPlans: [],
      interviewDebriefs: [],
      jdIntakeItems: [],
      jobLeads: [],
    };
    assert(
      snapshotJsonBytes(oversizedLegacySnapshot, true) > PROJECT_SNAPSHOT_SAFE_BYTES,
      `${packagePath}: capacity regression fixture must exceed one safe Host write`,
    );
    const compactSnapshot = compactProjectSnapshotPayload(oversizedLegacySnapshot);
    assert.deepEqual(
      Object.keys(compactSnapshot.interviewSets[0].questions[0]).sort(),
      ["bankQuestionId", "id", "why"].sort(),
      `${packagePath}: durable practice sets must reference canonical bank questions instead of copying them`,
    );
    assert(
      Object.hasOwn(oversizedLegacySnapshot.interviewSets[0].questions[0], "question"),
      `${packagePath}: project compaction must not mutate the hydrated runtime state`,
    );
    assert(
      snapshotJsonBytes(compactSnapshot) < snapshotJsonBytes(oversizedLegacySnapshot),
      `${packagePath}: canonical question references must reduce project snapshot size`,
    );
    const compactSmallSnapshot = compactProjectSnapshotPayload({
      ...oversizedLegacySnapshot,
      questionBank: oversizedLegacySnapshot.questionBank.slice(0, 1),
      interviewSets: [
        {
          ...oversizedLegacySnapshot.interviewSets[0],
          questions: oversizedLegacySnapshot.interviewSets[0].questions.slice(0, 1),
        },
      ],
    });
    assert.equal(
      projectSnapshotStorageNeedsMigration({
        ...compactSmallSnapshot,
        interviewSets: oversizedLegacySnapshot.interviewSets.slice(0, 1).map((set) => ({
          ...set,
          questions: set.questions.slice(0, 1),
        })),
      }),
      true,
      `${packagePath}: materialized legacy set questions must request a storage rewrite`,
    );
    assert.equal(
      projectSnapshotStorageNeedsMigration(compactSmallSnapshot),
      false,
      `${packagePath}: a compact bounded snapshot must not rewrite again on every load`,
    );
    const hydratedCompactLibrary = normalizeInterviewLibrary(
      compactSmallSnapshot.questionBank,
      compactSmallSnapshot.interviewSets,
      { now: "2026-08-09T00:00:00.000Z" },
    );
    assert.equal(
      hydratedCompactLibrary.interviewSets[0].questions[0].question,
      compactSmallSnapshot.questionBank[0].question,
      `${packagePath}: compact set references must hydrate from the canonical bank on load`,
    );
    const shardedLegacySnapshot = prepareProjectSnapshotDocuments(
      oversizedLegacySnapshot,
      {
        resume: {},
        questionBank: [],
        interviewSets: [],
        mockInterviewSessions: [],
        versions: [],
      },
      { generation: "a" },
    );
    assert(shardedLegacySnapshot.shards.length > 0);
    assert(snapshotJsonBytes(shardedLegacySnapshot.root) <= PROJECT_SNAPSHOT_SAFE_BYTES);
    assert(
      shardedLegacySnapshot.shards.every((shard) => shard.bytes <= PROJECT_SNAPSHOT_SAFE_BYTES),
      `${packagePath}: every project shard must fit one bounded Host write`,
    );
    assert.equal(projectSnapshotShardDescriptors(shardedLegacySnapshot.root).length, 2);
    const hydratedLegacySnapshot = hydrateProjectSnapshotDocuments(
      shardedLegacySnapshot.root,
      new Map(shardedLegacySnapshot.shards.map((shard) => [shard.path, shard.payload])),
    );
    assert.deepEqual(hydratedLegacySnapshot.questionBank, oversizedLegacySnapshot.questionBank);
    assert.deepEqual(hydratedLegacySnapshot.interviewSets, oversizedLegacySnapshot.interviewSets);
    assert.equal(nextSnapshotShardGeneration("a"), "b");
    const nextLegacySnapshot = structuredClone(oversizedLegacySnapshot);
    nextLegacySnapshot.questionBank[0].notes = "New generation only";
    const shardedNextLegacySnapshot = prepareProjectSnapshotDocuments(
      nextLegacySnapshot,
      {
        resume: {},
        questionBank: [],
        interviewSets: [],
        mockInterviewSessions: [],
        versions: [],
      },
      { generation: "b" },
    );
    const bothGenerationDocuments = new Map([
      ...shardedLegacySnapshot.shards.map((shard) => [shard.path, shard.payload]),
      ...shardedNextLegacySnapshot.shards.map((shard) => [shard.path, shard.payload]),
    ]);
    assert.equal(
      hydrateProjectSnapshotDocuments(shardedLegacySnapshot.root, bothGenerationDocuments)
        .questionBank[0].notes,
      "",
      `${packagePath}: writing the inactive generation must not change the active root`,
    );
    assert.equal(
      hydrateProjectSnapshotDocuments(shardedNextLegacySnapshot.root, bothGenerationDocuments)
        .questionBank[0].notes,
      "New generation only",
      `${packagePath}: switching the root must reveal the complete new generation`,
    );
    assert.throws(
      () => hydrateProjectSnapshotDocuments(shardedLegacySnapshot.root, new Map()),
      /分片无效或缺失/,
      `${packagePath}: a partial shard generation must never hydrate silently`,
    );
    const unsafeShardRoot = structuredClone(shardedLegacySnapshot.root);
    unsafeShardRoot.artifactStorage.shards[0].path = "career-data/private.json";
    assert.throws(
      () => projectSnapshotShardDescriptors(unsafeShardRoot),
      /索引项无效/,
      `${packagePath}: a shard index must never expand workspace read scope`,
    );
    const normalizedNoOpSnapshot = structuredClone(oversizedLegacySnapshot);
    normalizedNoOpSnapshot.updatedAt = "2026-08-11T15:10:49.593Z";
    normalizedNoOpSnapshot.resume.parentVersionId = "";
    normalizedNoOpSnapshot.resume.revisionReason = "";
    normalizedNoOpSnapshot.questionBank[0].jobRequirementRefs = [];
    normalizedNoOpSnapshot.questionBank[0].userEdited = false;
    assert(
      projectSnapshotsSemanticallyEqual(oversizedLegacySnapshot, normalizedNoOpSnapshot),
      `${packagePath}: timestamps and newly explicit empty defaults must not trigger a project rewrite`,
    );
    assert.equal(
      projectSnapshotSemanticKey(oversizedLegacySnapshot),
      projectSnapshotSemanticKey(normalizedNoOpSnapshot),
      `${packagePath}: the loaded semantic key must ignore root timestamps and explicit defaults`,
    );
    normalizedNoOpSnapshot.questionBank[0].notes = "a real answer change";
    assert(
      !projectSnapshotsSemanticallyEqual(oversizedLegacySnapshot, normalizedNoOpSnapshot),
      `${packagePath}: a real nested project change must still be persisted`,
    );
    const overflowBank = Array.from({ length: QUESTION_BANK_LIMIT + 1 }, (_, index) => ({
      id: `overflow-bank-${index}`,
      question: `Overflow integrity question ${index}`,
    }));
    const overflowSet = {
      id: "set-overflow",
      questions: Array.from({ length: 30 }, (_, index) => ({
        id: `overflow-local-${index}`,
        bankQuestionId: `overflow-bank-${index + QUESTION_BANK_LIMIT - 29}`,
        question: `Overflow integrity question ${index + QUESTION_BANK_LIMIT - 29}`,
      })),
    };
    const cappedLibrary = normalizeInterviewLibrary(overflowBank, [overflowSet], {
      now: "2026-08-09T00:00:00.000Z",
    });
    assert.equal(cappedLibrary.questionBank.length, QUESTION_BANK_LIMIT);
    assert.equal(cappedLibrary.interviewSets[0].questions.length, 29);
    assert(
      cappedLibrary.interviewSets[0].questions.every((question) =>
        cappedLibrary.questionBank.some((item) => item.id === question.bankQuestionId),
      ),
      `${packagePath}: capped libraries must not leave practice sets with dangling references`,
    );
    const archivedCapacity = normalizeInterviewLibrary(
      [
        ...Array.from({ length: QUESTION_BANK_LIMIT - 1 }, (_, index) => ({
          id: `active-${index}`,
          question: `Active retained question ${index}`,
          status: "ready",
        })),
        { id: "archived-old", question: "Archived old question", status: "archived" },
        { id: "new-inbox", question: "Newly imported question", status: "inbox" },
      ],
      [],
      { now: "2026-08-09T00:00:00.000Z" },
    );
    assert.equal(archivedCapacity.questionBank.length, QUESTION_BANK_LIMIT);
    assert(archivedCapacity.questionBank.some((item) => item.id === "new-inbox"));
    assert(!archivedCapacity.questionBank.some((item) => item.id === "archived-old"));
    const existingBoundedBank = Array.from({ length: 20 }, (_, index) => ({
      id: `bounded-bank-${index}`,
      question: `How would you explain bounded practice question ${index}?`,
      category: "Architecture",
      competency: "Trade-off judgment",
      sourceRefs: [`source:${index}`],
      sourceSetIds: [`bounded-set-${index}`],
      status: "ready",
    }));
    const existingBoundedSets = existingBoundedBank.map((question, index) => ({
      id: `bounded-set-${index}`,
      questions: [
        {
          id: `bounded-local-${index}`,
          bankQuestionId: question.id,
          question: question.question,
        },
      ],
    }));
    const rotatedSets = normalizeInterviewLibrary(
      existingBoundedBank,
      [
        {
          id: "bounded-set-new",
          questions: [
            {
              id: "bounded-local-new",
              question: "How would you add a new bounded practice set safely?",
              category: "Reliability",
              competency: "Retention policy",
              evidenceRefs: ["source:new"],
            },
          ],
        },
        ...existingBoundedSets,
      ],
      { now: "2026-08-09T00:00:00.000Z" },
    );
    assert.equal(rotatedSets.interviewSets.length, 20);
    assert.equal(rotatedSets.interviewSets[0].id, "bounded-set-new");
    assert(!rotatedSets.interviewSets.some((set) => set.id === "bounded-set-19"));
    assert.deepEqual(
      rotatedSets.questionBank.find((item) => item.id === "bounded-bank-19").sourceSetIds,
      [],
      `${packagePath}: evicting an old set must prune its canonical reverse reference`,
    );
    const originalWording = normalizeInterviewLibrary(
      [],
      [
        {
          id: "set-original-wording",
          questions: [
            {
              id: "local-original",
              question: "How would you recover an interrupted workflow?",
              category: "Reliability",
            },
          ],
        },
      ],
      { now: "2026-08-09T00:00:00.000Z" },
    );
    const originalBankId = originalWording.questionBank[0].id;
    const rewrittenQuestion = updateInterviewBankQuestion(
      originalWording.questionBank,
      originalBankId,
      {
        origin: "manual",
        question:
          "A workflow stops midway through execution. Explain your recovery boundary and replay strategy.",
      },
      "2026-08-09T00:30:00.000Z",
    );
    assert(
      rewrittenQuestion.updated.fingerprintAliases.includes(
        interviewQuestionFingerprint("How would you recover an interrupted workflow?"),
      ),
    );
    const regeneratedOldWording = normalizeInterviewLibrary(
      rewrittenQuestion.questionBank,
      originalWording.interviewSets,
      { now: "2026-08-09T00:45:00.000Z" },
    );
    assert.equal(
      regeneratedOldWording.questionBank.length,
      1,
      `${packagePath}: an old generated wording must resolve through a user edit's fingerprint alias`,
    );
    assert.equal(regeneratedOldWording.questionBank[0].id, originalBankId);
    assert.equal(regeneratedOldWording.questionBank[0].origin, "manual");
    assert.match(regeneratedOldWording.questionBank[0].question, /recovery boundary/);
    const curatedConflict = normalizeInterviewLibrary(
      [
        {
          id: "manual-latest",
          question: "How would you recover a failed canonical import?",
          category: "Reliability",
          competency: "Recovery ownership",
          type: "scenario",
          difficulty: "挑战",
          priority: "high",
          status: "ready",
          origin: "manual",
          tags: [],
          sourceRefs: ["user:verified-import"],
          answerPoints: [],
          recommendedAnswer: "",
          followUps: [],
          notes: "",
          revision: 4,
          updatedAt: "2026-08-09T04:00:00.000Z",
        },
        {
          id: "manual-older-shadow",
          question: "How would you recover a failed canonical import!",
          category: "Old manual category",
          competency: "Old manual competency",
          type: "technical",
          status: "ready",
          origin: "manual",
          tags: ["old-manual-tag"],
          sourceRefs: ["user:older-import"],
          answerPoints: ["Old manual point"],
          recommendedAnswer: "Old manual answer",
          followUps: ["Old manual follow-up"],
          notes: "Old manual note",
          revision: 3,
          updatedAt: "2026-08-09T03:00:00.000Z",
        },
        {
          id: "generated-shadow",
          question: "How would you recover a failed canonical import?",
          category: "Generated category",
          competency: "Generated competency",
          type: "technical",
          status: "ready",
          origin: "generated",
          tags: ["generated-tag"],
          sourceRefs: ["session:stale-generation"],
          answerPoints: ["Generated point"],
          recommendedAnswer: "Generated answer",
          followUps: ["Generated follow-up"],
          notes: "Generated note",
          revision: 99,
          updatedAt: "2026-08-09T05:00:00.000Z",
        },
        {
          id: "real-interview-note-shadow",
          question: "How would you recover a failed canonical import?",
          category: "Real interview",
          competency: "Recovery ownership",
          status: "inbox",
          origin: "real_interview",
          sourceRefs: ["real-interview:later"],
          notes: "Raw debrief note must not replace an intentionally cleared curated note.",
          updatedAt: "2026-08-09T05:30:00.000Z",
        },
      ],
      [],
      { now: "2026-08-09T06:00:00.000Z" },
    );
    assert.equal(curatedConflict.questionBank.length, 1);
    assert.equal(curatedConflict.questionBank[0].id, "manual-latest");
    assert.equal(curatedConflict.questionBank[0].category, "Reliability");
    assert.equal(curatedConflict.questionBank[0].competency, "Recovery ownership");
    assert.equal(curatedConflict.questionBank[0].type, "scenario");
    assert.deepEqual(curatedConflict.questionBank[0].tags, []);
    assert.deepEqual(curatedConflict.questionBank[0].answerPoints, []);
    assert.equal(curatedConflict.questionBank[0].recommendedAnswer, "");
    assert.deepEqual(curatedConflict.questionBank[0].followUps, []);
    assert.equal(curatedConflict.questionBank[0].notes, "");
    assert.equal(curatedConflict.questionBank[0].revision, 4);
    assert.equal(
      curatedConflict.questionBank[0].updatedAt,
      "2026-08-09T04:00:00.000Z",
      "generated shadows and older manual duplicates must never outrank the latest curation",
    );
    const legacyAliasLibrary = normalizeInterviewLibrary(
      [
        {
          id: "canonical-question",
          question: "请讲一次你推动跨团队项目落地的经历",
          sourceRefs: ["session:current"],
        },
        {
          id: "legacy-duplicate",
          question: "请讲一次你推动跨团队项目落地的经历。",
          sourceRefs: ["session:legacy"],
        },
      ],
      [
        {
          id: "set-legacy-alias",
          questions: [
            {
              id: "set-question",
              bankQuestionId: "legacy-duplicate",
              question: "这份旧题单里的题干后来发生了变化",
            },
          ],
        },
      ],
      { now: "2026-08-09T00:00:00.000Z" },
    );
    assert.equal(legacyAliasLibrary.questionBank.length, 1);
    assert.equal(
      legacyAliasLibrary.interviewSets[0].questions[0].bankQuestionId,
      "canonical-question",
    );
    assert.equal(
      interviewQuestionFingerprint("What changed after launch?"),
      interviewQuestionFingerprint(" WHAT changed after launch "),
      `${packagePath}: fingerprints must ignore punctuation, case, and whitespace`,
    );
    assert.equal(
      interviewQuestionFingerprint("Tell me about a difficult trade-off."),
      interviewQuestionFingerprint("Tell me about a difficult trade off"),
      `${packagePath}: punctuation and whitespace variants should still deduplicate`,
    );
    assert.notEqual(
      interviewQuestionFingerprint("How did metric 1-23 change?"),
      interviewQuestionFingerprint("How did metric 12-3 change?"),
      `${packagePath}: fingerprint normalization must preserve token boundaries`,
    );
    assert.notEqual(
      interviewQuestionFingerprint("Explain the C++ memory model"),
      interviewQuestionFingerprint("Explain the C memory model"),
      `${packagePath}: fingerprints must preserve meaningful programming-language symbols`,
    );
    assert.equal(
      inferInterviewQuestionType("能力差距", "材料缺少量化结果时，如何用证据证明影响？"),
      "resume_probe",
      `${packagePath}: evidence and credibility gaps should be filterable as resume probes`,
    );
    assert.equal(
      inferInterviewQuestionType("Resume", "Which metric supports this claim?"),
      "resume_probe",
    );
    assert.deepEqual(
      normalizeInterviewQuestionSourceRefs(["SESSION:CURRENT", "file:notes.md"], {
        origin: "session",
        traceId: "trace-42",
      }),
      ["session:trace-42", "file:notes.md"],
    );
    assert.deepEqual(
      normalizeInterviewQuestionSourceRefs(["file:notes.md"], {
        origin: "session",
        sessionId: "session-7",
      }),
      ["session:session-7", "file:notes.md"],
      `${packagePath}: Session imports must retain a durable source anchor`,
    );
    assert(
      normalizeInterviewLibrary(
        [
          {
            id: "legacy-fingerprint-record",
            fingerprint: "q-legacy-algorithm",
            question: "How would you compare a C++ and C boundary?",
            status: "inbox",
          },
        ],
        [],
      ).questionBank[0].fingerprintAliases.includes("q-legacy-algorithm"),
      `${packagePath}: fingerprint algorithm upgrades must retain the stored fingerprint as an alias`,
    );
    const bankQuestionId = migratedInterviewLibrary.questionBank[0].id;
    const curatedInterviewLibrary = updateInterviewBankQuestion(
      migratedInterviewLibrary.questionBank,
      bankQuestionId,
      {
        origin: "manual",
        status: "mastered",
        competency: "Architecture judgment",
        tags: ["system-design", "trade-off"],
        notes: "Keep the answer focused on the decision boundary.",
        practiceAttempts: [
          {
            id: "attempt-1",
            answer: "I first isolated the failure boundary, then validated recovery with a replay.",
            inputMode: "voice",
            practiceSessionId: "mock-one",
            interviewSetId: "set-one",
            createdAt: "2026-08-09T00:59:00.000Z",
            updatedAt: "2026-08-09T00:59:30.000Z",
          },
        ],
        practiceReviews: [{ id: "review-1", overallScore: 88 }],
      },
      "2026-08-09T01:00:00.000Z",
    );
    assert.equal(curatedInterviewLibrary.updated.revision, 2);
    assert.equal(curatedInterviewLibrary.updated.status, "mastered");
    assert.equal(curatedInterviewLibrary.updated.practiceAttempts.length, 1);
    assert.equal(latestQuestionPracticeAttempt(curatedInterviewLibrary.updated).id, "attempt-1");
    assert.equal(curatedInterviewLibrary.updated.practiceReviews.length, 1);
    const actualInterviewQuestions = interviewBankQuestionsFromDebrief(
      {
        id: "debrief-1",
        jobId: "job-a",
        questions: [
          {
            question: "Tell me about a difficult architecture trade-off.",
            reportedFeedback: "The decision was clear, but the result was vague.",
            analysis: "Add a supported outcome and validation method.",
            betterAnswerPoints: ["State the constraint", "Explain the decision", "Validate impact"],
          },
        ],
      },
      { now: "2026-08-09T01:30:00.000Z" },
    );
    assert.equal(actualInterviewQuestions[0].origin, "real_interview");
    assert.equal(actualInterviewQuestions[0].status, "inbox");
    assert.deepEqual(actualInterviewQuestions[0].sourceRefs, ["real-interview:debrief-1"]);
    assert.match(actualInterviewQuestions[0].notes, /面试方反馈/);
    const generatedInterviewDeduped = normalizeInterviewLibrary(
      [
        {
          id: "generated-practice-question",
          question: actualInterviewQuestions[0].question,
          category: "System design",
          competency: "Architecture judgment",
          status: "ready",
          origin: "generated",
          sourceRefs: ["set:generated-practice"],
        },
        ...actualInterviewQuestions,
      ],
      [],
      { now: "2026-08-09T01:30:00.000Z" },
    );
    assert.equal(generatedInterviewDeduped.questionBank.length, 1);
    assert.equal(generatedInterviewDeduped.questionBank[0].status, "ready");
    assert.equal(generatedInterviewDeduped.questionBank[0].origin, "generated");
    assert(
      generatedInterviewDeduped.questionBank[0].sourceRefs.includes("real-interview:debrief-1"),
      `${packagePath}: a real-interview duplicate must add Source without invalidating an existing generated item`,
    );
    const actualInterviewMerged = normalizeInterviewLibrary(
      curatedInterviewLibrary.questionBank,
      [],
      { now: "2026-08-09T01:30:00.000Z" },
    );
    const actualInterviewDeduped = normalizeInterviewLibrary(
      [...actualInterviewMerged.questionBank, ...actualInterviewQuestions],
      [],
      { now: "2026-08-09T01:30:00.000Z" },
    );
    assert.equal(actualInterviewDeduped.questionBank.length, 1);
    assert.equal(actualInterviewDeduped.questionBank[0].status, "mastered");
    assert.equal(actualInterviewDeduped.questionBank[0].origin, "manual");
    assert(actualInterviewDeduped.questionBank[0].sourceRefs.includes("real-interview:debrief-1"));
    assert(
      actualInterviewDeduped.questionBank[0].answerPoints.includes("Validate impact"),
      `${packagePath}: a real interview should enrich, not downgrade, a curated bank item`,
    );
    const syncedPracticeSets = syncInterviewSetsFromBank(
      migratedInterviewLibrary.interviewSets,
      curatedInterviewLibrary.questionBank,
    );
    assert.equal(syncedPracticeSets[0].questions[0].practiceAttempts[0].id, "attempt-1");
    assert.equal(syncedPracticeSets[0].questions[0].practiceReviews[0].overallScore, 88);
    assert.equal(syncedPracticeSets[1].questions[0].category, "System design");
    const staleReviewSets = migratedInterviewLibrary.interviewSets.map((set) => ({
      ...set,
      questions: set.questions.map((question) => ({
        ...question,
        practiceReviews: [{ id: "review-1", overallScore: 10 }],
      })),
    }));
    const regeneratedInterviewLibrary = normalizeInterviewLibrary(
      curatedInterviewLibrary.questionBank,
      staleReviewSets,
      { now: "2026-08-09T02:00:00.000Z" },
    );
    assert.equal(regeneratedInterviewLibrary.questionBank.length, 1);
    assert.equal(regeneratedInterviewLibrary.questionBank[0].status, "mastered");
    assert.equal(
      regeneratedInterviewLibrary.questionBank[0].notes,
      "Keep the answer focused on the decision boundary.",
      `${packagePath}: regenerated sets must not replace user-curated bank fields`,
    );
    assert.equal(regeneratedInterviewLibrary.questionBank[0].practiceReviews.length, 1);
    assert.equal(regeneratedInterviewLibrary.questionBank[0].practiceAttempts.length, 1);
    assert.equal(
      regeneratedInterviewLibrary.questionBank[0].practiceReviews[0].overallScore,
      88,
      `${packagePath}: stale set snapshots must not replace canonical practice reviews`,
    );
    assert.equal(
      regeneratedInterviewLibrary.questionBank[0].updatedAt,
      "2026-08-09T01:00:00.000Z",
      `${packagePath}: regeneration must not make an untouched manual edit look newer`,
    );
    const replacedSources = updateInterviewBankQuestion(
      regeneratedInterviewLibrary.questionBank,
      bankQuestionId,
      {
        origin: "manual",
        sourceRefs: ["user:question-bank:verified-source"],
        competency: "Recovery ownership",
        type: "scenario",
        tags: ["reliability", "recovery"],
      },
      "2026-08-09T03:00:00.000Z",
    );
    const libraryAfterDirectEdit = normalizeInterviewLibrary(
      replacedSources.questionBank,
      syncInterviewSetsFromBank(
        regeneratedInterviewLibrary.interviewSets,
        replacedSources.questionBank,
      ),
      { now: "2026-08-09T03:00:00.000Z" },
    );
    assert.deepEqual(libraryAfterDirectEdit.questionBank[0].sourceRefs, [
      "user:question-bank:verified-source",
    ]);
    assert.deepEqual(libraryAfterDirectEdit.interviewSets[0].questions[0].evidenceRefs, [
      "user:question-bank:verified-source",
    ]);
    assert.deepEqual(libraryAfterDirectEdit.interviewSets[0].questions[0].sourceRefs, [
      "user:question-bank:verified-source",
    ]);
    assert.equal(
      libraryAfterDirectEdit.interviewSets[0].questions[0].competency,
      "Recovery ownership",
    );
    assert.equal(libraryAfterDirectEdit.interviewSets[0].questions[0].type, "scenario");
    assert.deepEqual(libraryAfterDirectEdit.interviewSets[0].questions[0].tags, [
      "reliability",
      "recovery",
    ]);
    const clearedSources = updateInterviewBankQuestion(
      libraryAfterDirectEdit.questionBank,
      bankQuestionId,
      { origin: "manual", sourceRefs: [], competency: "", recommendedAnswer: "" },
      "2026-08-09T04:00:00.000Z",
    );
    const setWithStaleShadowSource = libraryAfterDirectEdit.interviewSets.map((set) => ({
      ...set,
      questions: set.questions.map((question) => ({
        ...question,
        sourceRefs: ["legacy:shadow-source"],
        evidenceRefs: ["legacy:shadow-source"],
        competency: "Legacy shadow competency",
        recommendedAnswer: "Legacy shadow answer",
      })),
    }));
    const libraryAfterSourceRemoval = normalizeInterviewLibrary(
      clearedSources.questionBank,
      setWithStaleShadowSource,
      { now: "2026-08-09T04:00:00.000Z" },
    );
    assert.deepEqual(
      libraryAfterSourceRemoval.questionBank[0].sourceRefs,
      [],
      "deleting a source in the canonical editor must clear stale set shadow fields",
    );
    assert.deepEqual(libraryAfterSourceRemoval.interviewSets[0].questions[0].sourceRefs, []);
    assert.deepEqual(libraryAfterSourceRemoval.interviewSets[0].questions[0].evidenceRefs, []);
    assert.equal(libraryAfterSourceRemoval.questionBank[0].competency, "");
    assert.equal(libraryAfterSourceRemoval.interviewSets[0].questions[0].competency, "");
    assert.equal(libraryAfterSourceRemoval.questionBank[0].recommendedAnswer, "");
    assert.equal(libraryAfterSourceRemoval.interviewSets[0].questions[0].recommendedAnswer, "");
    const mockScoreSummary = mockSessionScoreSummary(
      [
        {
          id: "bank-one",
          practiceReviews: [
            {
              practiceSessionId: "mock-one",
              overallScore: 80,
              dimensions: { evidence: 70, structure: 80, depth: 80, relevance: 90 },
            },
          ],
        },
        {
          id: "bank-two",
          practiceReviews: [
            {
              practiceSessionId: "mock-one",
              overallScore: 90,
              dimensions: { evidence: 90, structure: 80, depth: 100, relevance: 90 },
            },
          ],
        },
      ],
      ["bank-one", "bank-two"],
      "mock-one",
    );
    assert.deepEqual(mockScoreSummary, {
      reviewedCount: 2,
      averageScore: 85,
      dimensions: { evidence: 80, structure: 80, depth: 90, relevance: 90 },
    });
    assert.deepEqual(normalizeMockSessionScoreSummary({ averageScore: 130 }), {
      reviewedCount: 0,
      averageScore: 100,
      dimensions: { evidence: 0, structure: 0, depth: 0, relevance: 0 },
    });
    assert.equal(
      normalizeMockSessionScoreSummary({}, { reviewedCount: 2, averageScore: 76 }).averageScore,
      76,
    );
    assert.equal(normalizeMockSessionScoreSummary({ reviewedCount: 99 }).reviewedCount, 40);
    const weakLatestQuestion = {
      status: "ready",
      practiceReviews: [
        { id: "older-strong", overallScore: 91, createdAt: "2026-08-08T10:00:00.000Z" },
        { id: "newer-weak", overallScore: 64, createdAt: "2026-08-09T10:00:00.000Z" },
      ],
    };
    assert.equal(latestQuestionPracticeReview(weakLatestQuestion).id, "newer-weak");
    assert.equal(questionNeedsWork(weakLatestQuestion), true);
    assert.equal(questionNeedsWork({ ...weakLatestQuestion, status: "inbox" }), false);
    assert.deepEqual(
      mockSessionProgress({
        questionCount: 8,
        questionIds: [],
        reviewedQuestionIds: [],
        scoreSummary: { reviewedCount: 5 },
      }),
      { answeredCount: 5, reviewedCount: 5, questionCount: 8 },
      `${packagePath}: a historical mock must retain progress after canonical references disappear`,
    );
    assert.deepEqual(
      mockSessionProgress({
        questionIds: ["bank-one", "bank-two"],
        answeredQuestionIds: ["bank-one"],
        reviewedQuestionIds: [],
      }),
      { answeredCount: 1, reviewedCount: 0, questionCount: 2 },
      `${packagePath}: Panel answers must count as progress before optional AI scoring`,
    );
    assert.deepEqual(
      resolveMockSessionScoreSummary(
        {
          reviewedCount: 5,
          averageScore: 82,
          dimensions: { evidence: 80, structure: 84, depth: 81, relevance: 83 },
        },
        {
          reviewedCount: 3,
          averageScore: 91,
          dimensions: { evidence: 90, structure: 92, depth: 89, relevance: 93 },
        },
        "completed",
      ),
      {
        reviewedCount: 5,
        averageScore: 82,
        dimensions: { evidence: 80, structure: 84, depth: 81, relevance: 83 },
      },
      "completed mock sessions retain their durable score snapshot after old reviews are pruned",
    );
    assert.deepEqual(
      resolveMockSessionScoreSummary(
        {
          reviewedCount: 2,
          averageScore: 82,
          dimensions: { evidence: 80, structure: 84, depth: 81, relevance: 83 },
        },
        {
          reviewedCount: 2,
          averageScore: 55,
          dimensions: { evidence: 50, structure: 60, depth: 55, relevance: 55 },
        },
        "completed",
      ).averageScore,
      82,
      "completed mock scores must not drift when later data has the same review count",
    );
    assert.equal(
      resolveMockSessionScoreSummary(
        { reviewedCount: 1, averageScore: 60 },
        { reviewedCount: 2, averageScore: 78 },
        "in_progress",
      ).averageScore,
      78,
      "in-progress mock sessions prefer the latest computed score",
    );
    const reviewTargetSession = {
      id: "mock-target",
      interviewSetId: "set-a",
      status: "in_progress",
      questionIds: ["bank-one"],
    };
    assert.equal(mockSessionReviewTargetError(reviewTargetSession, "bank-one", "set-a"), "");
    assert.equal(
      mockSessionReviewTargetError(reviewTargetSession, "bank-two", "set-a"),
      "bank_question_id 不属于这场模拟面试",
    );
    assert.equal(
      mockSessionReviewTargetError(reviewTargetSession, "bank-one", "set-b"),
      "interview_set_id 与这场模拟面试不一致",
    );
    assert.equal(
      mockSessionReviewTargetError(
        {
          ...reviewTargetSession,
          status: "completed",
          answeredQuestionIds: ["bank-one"],
        },
        "bank-one",
      ),
      "",
      `${packagePath}: an explicitly requested AI review may score a saved Panel answer later`,
    );
    assert.equal(
      mockSessionReviewTargetError({ ...reviewTargetSession, status: "completed" }, "bank-one"),
      "这场模拟已经结束，且该题没有已保存回答，不能补写评分",
    );
    assert(toolNames.has("save_candidate_context"), `${packagePath}: context tool is required`);
    assert(toolNames.has("save_job_research"), `${packagePath}: research tool is required`);
    assert(
      manifest.agent.tools.length <= 16,
      `${packagePath}: installer-compatible manifests may expose at most 16 tools`,
    );
    assert(
      toolNames.has("update_application_progress"),
      `${packagePath}: application progress tool is required`,
    );
    const applicationTool = manifest.agent.tools.find(
      (tool) => tool.name === "update_application_progress",
    );
    assert(
      applicationTool.inputSchema.properties.status.enum.includes("inbox"),
      `${packagePath}: application tool must support triage inbox`,
    );
    assert(
      toolNames.has("complete_execution_trace"),
      `${packagePath}: explicit trace outcome tool is required`,
    );
    assert(
      toolNames.has("save_channel_verification"),
      `${packagePath}: one-provider channel verification tool is required`,
    );
    assert(
      toolNames.has("save_jd_intake_results"),
      `${packagePath}: JD source intake result tool is required`,
    );
    for (const tool of manifest.agent.tools.filter((item) => !item.readOnly)) {
      assert.equal(
        tool.inputSchema.properties?.trace_id?.type,
        "string",
        `${packagePath}: ${tool.name} must accept explicit trace_id correlation`,
      );
    }
    const contextTool = manifest.agent.tools.find((tool) => tool.name === "get_job_search_context");
    assert.equal(
      contextTool.inputSchema.properties?.trace_id,
      undefined,
      `${packagePath}: read-only context must not require trace_id`,
    );
    assert(
      contextTool.inputSchema.properties.scope.enum.includes("interview"),
      `${packagePath}: context tool must expose targeted interview reads`,
    );
    assert(
      contextTool.inputSchema.properties.scope.enum.includes("questions") &&
        contextTool.inputSchema.properties.scope.enum.includes("practice"),
      `${packagePath}: context tool must separate question indexes from exact practice reads`,
    );
    assert.equal(
      contextTool.inputSchema.properties.limit.maximum,
      50,
      `${packagePath}: context catalogs must stay bounded`,
    );
    const largeContextFixture = {
      project: { name: "large-project", hasSnapshot: true },
      sessionId: "session-large",
      projectStatePath: "job-hunt-panel.json",
      activeTraceId: "trace-large",
      selectedJobId: "agent-job-ms6a7idj-itvox",
      selectedBaseResumeId: "resume-base",
      selectedInterviewSetId: "agent-interview-ms6a9mut-m7fc2",
      jobs: Array.from({ length: 40 }, (_, index) => ({
        id: index ? `job-${index}` : "agent-job-ms6a7idj-itvox",
        company: `Company ${index}`,
        title: `Role ${index}`,
        description: "J".repeat(24_000),
        status: "saved",
      })),
      jobLeads: [],
      jdInboxPath: "career-data/jd/inbox",
      jdIntakeItems: [],
      profile: { name: "Candidate", summary: "P".repeat(12_000) },
      repositories: [{ id: "repo-1", summary: "R".repeat(4_000) }],
      workHistory: [{ id: "work-1", achievements: ["W".repeat(4_000)] }],
      jobResearch: [],
      workflowRuns: [],
      resumes: Array.from({ length: 20 }, (_, index) => ({
        id: index ? `resume-${index}` : "resume-base",
        kind: "base",
        title: `Resume ${index}`,
        markdown: "M".repeat(30_000),
        claimEvidence: [],
        candidateQuestions: [],
      })),
      questionBank: Array.from({ length: 120 }, (_, index) => ({
        id: `bank-${index}`,
        question: `Question ${index}`,
        answerPoints: ["A".repeat(2_000)],
        sourceRefs: ["session:fixture"],
        status: "ready",
        practiceAttempts:
          index === 0
            ? Array.from({ length: 40 }, (_, attemptIndex) => ({
                id: `attempt-${attemptIndex}`,
                answer: `${attemptIndex}`.repeat(6_000),
                practiceSessionId: attemptIndex === 0 ? "mock-1" : `mock-${attemptIndex + 1}`,
                createdAt: `2026-08-09T${String(attemptIndex % 24).padStart(2, "0")}:00:00.000Z`,
              }))
            : [],
      })),
      interviewSets: [
        {
          id: "agent-interview-ms6a9mut-m7fc2",
          title: "上海 Agent 开发共性面试",
          jobId: "agent-job-ms6a7idj-itvox",
          questions: [
            { bankQuestionId: "bank-0", recommendedAnswer: "S".repeat(80_000) },
            { bankQuestionId: "bank-1", recommendedAnswer: "S".repeat(80_000) },
          ],
        },
      ],
      mockSessions: [
        {
          id: "mock-1",
          interviewSetId: "agent-interview-ms6a9mut-m7fc2",
          questionIds: ["bank-0", "bank-1"],
          reviewedQuestionIds: [],
          status: "in_progress",
        },
      ],
      preparationPlans: [],
      interviewDebriefs: [],
      workflowSelection: { jobIds: [], taskIds: ["prepare"] },
      discoveryPreferences: {},
      channelVerifications: [],
      providerCatalog: [],
      evidencePolicy: "verified only",
      collectionPolicy: "public sources",
      applicationPolicy: "explicit progress only",
    };
    const summaryContext = buildJobSearchContext(largeContextFixture);
    assert(jobSearchContextJsonBytes(summaryContext) < JOB_SEARCH_CONTEXT_MAX_BYTES);
    assert.equal(summaryContext.scope, "summary");
    assert.equal(summaryContext.counts.jobs, 40);
    assert.equal(summaryContext.opportunities, undefined);
    assert.equal(summaryContext.resumeVersions, undefined);
    const targetedInterviewContext = buildJobSearchContext(largeContextFixture, {
      scope: "interview",
      interviewSetId: "agent-interview-ms6a9mut-m7fc2",
      bankQuestionId: "bank-0",
      mockSessionId: "mock-1",
    });
    assert.equal(targetedInterviewContext.questions.length, 1);
    assert.equal(targetedInterviewContext.questions[0].id, "bank-0");
    assert.equal(targetedInterviewContext.questions[0].practiceAttempts.length, 1);
    assert.equal(targetedInterviewContext.questions[0].practiceAttempts[0].id, "attempt-0");
    assert.equal(targetedInterviewContext.questions[0].practiceHistory.attemptCount, 40);
    assert.equal(targetedInterviewContext.jobs.length, 1);
    assert(jobSearchContextJsonBytes(targetedInterviewContext) < INTERVIEW_CONTEXT_MAX_BYTES);
    const paginatedInterviewContext = buildJobSearchContext(
      {
        ...largeContextFixture,
        interviewSets: [
          {
            ...largeContextFixture.interviewSets[0],
            questions: Array.from({ length: 12 }, (_, index) => ({
              bankQuestionId: `bank-${index}`,
            })),
          },
        ],
      },
      {
        scope: "interview",
        interviewSetId: "agent-interview-ms6a9mut-m7fc2",
        cursor: 0,
        limit: 50,
      },
    );
    assert.equal(paginatedInterviewContext.questions.length, 5);
    assert.equal(paginatedInterviewContext.questionPage.limit, 5);
    assert.equal(paginatedInterviewContext.questionPage.nextCursor, 5);
    assert(
      paginatedInterviewContext.questions.every(
        (question) =>
          question.practiceAttempts.length === 0 &&
          question.practiceReviews.length === 0 &&
          question.practiceHistory.filter === "counts-only",
      ),
      `${packagePath}: whole-set reads must not grow with answer and review history`,
    );
    assert(
      jobSearchContextJsonBytes(paginatedInterviewContext) < INTERVIEW_CONTEXT_MAX_BYTES,
      `${packagePath}: interview pages must stay under the 64 KiB execution budget`,
    );
    const interviewCatalog = buildJobSearchContext(largeContextFixture, {
      scope: "interviews",
      cursor: 0,
      limit: 10,
    });
    assert.equal(interviewCatalog.questionBank.items.length, 10);
    assert.equal(interviewCatalog.questionBank.nextCursor, 10);
    const questionCatalog = buildJobSearchContext(largeContextFixture, {
      scope: "questions",
      status: "ready",
      search: "Question",
      cursor: 0,
      limit: 10,
    });
    assert.equal(questionCatalog.questions.items.length, 10);
    assert.equal(questionCatalog.questions.nextCursor, 10);
    assert.equal(questionCatalog.questions.items[0].sourceRefs, undefined);
    assert.equal(questionCatalog.questions.items[0].sourceRefCount, 1);
    const exactPracticeContext = buildJobSearchContext(largeContextFixture, {
      scope: "practice",
      interviewSetId: "agent-interview-ms6a9mut-m7fc2",
      bankQuestionId: "bank-0",
      mockSessionId: "mock-1",
      practiceAttemptId: "attempt-0",
    });
    assert.equal(exactPracticeContext.question.id, "bank-0");
    assert.equal(exactPracticeContext.practiceAttempt.id, "attempt-0");
    assert.equal(exactPracticeContext.question.practiceAttempts, undefined);
    assert.equal(exactPracticeContext.candidateEvidence.profile.summary.length, 3000);
    assert(
      jobSearchContextJsonBytes(exactPracticeContext) < INTERVIEW_PRACTICE_CONTEXT_MAX_BYTES,
      `${packagePath}: exact practice context must stay under the 64 KiB scoring budget`,
    );
    const boundedLegacyPracticeContext = buildJobSearchContext(
      {
        ...largeContextFixture,
        questionBank: largeContextFixture.questionBank.map((question, index) =>
          index
            ? question
            : {
                ...question,
                recommendedAnswer: "R".repeat(100_000),
                notes: "N".repeat(100_000),
                answerPoints: Array.from({ length: 30 }, () => "A".repeat(2_000)),
                followUps: Array.from({ length: 30 }, () => "F".repeat(2_000)),
                practiceReviews: Array.from({ length: 20 }, (_, reviewIndex) => ({
                  id: `review-${reviewIndex}`,
                  practiceAttemptId: "attempt-0",
                  optimizedAnswer: "O".repeat(3_000),
                  improvements: ["I".repeat(500)],
                  createdAt: `2026-08-10T${String(reviewIndex % 24).padStart(2, "0")}:00:00.000Z`,
                })),
              },
        ),
      },
      {
        scope: "practice",
        bankQuestionId: "bank-0",
        practiceAttemptId: "attempt-0",
      },
    );
    assert.equal(boundedLegacyPracticeContext.question.recommendedAnswer.length, 6_000);
    assert.equal(boundedLegacyPracticeContext.question.notes.length, 2_000);
    assert.equal(boundedLegacyPracticeContext.recentReviews.length, 1);
    assert(
      jobSearchContextJsonBytes(boundedLegacyPracticeContext) <
        INTERVIEW_PRACTICE_CONTEXT_MAX_BYTES,
      `${packagePath}: legacy question prose and review history must be bounded before scoring`,
    );
    assert.throws(
      () =>
        buildJobSearchContext(largeContextFixture, {
          scope: "interview",
          interviewSetId: "agent-interview-ms6a9mut-m7fc2",
          bankQuestionId: "bank-99",
        }),
      /不属于题单/,
    );
    assert.match(
      appScript,
      /target\?\.kind === "question"[\s\S]*?"practice"[\s\S]*?bank_question_id[\s\S]*?practice_attempt_id/,
      `${packagePath}: question discussions must request exact practice context`,
    );
    assert(
      toolNames.has("save_preparation_plan"),
      `${packagePath}: preparation plan tool is required`,
    );
    assert(
      toolNames.has("save_interview_debrief"),
      `${packagePath}: interview debrief tool is required`,
    );
    assert(
      toolNames.has("save_interview_practice_review"),
      `${packagePath}: scored interview practice write-back tool is required`,
    );
    assert.deepEqual(
      manifest.agent.skills,
      [
        "agent/skills/job-hunt-workflow/SKILL.md",
        "agent/skills/job-intelligence/SKILL.md",
        "agent/skills/resume-writing/SKILL.md",
        "agent/skills/resume-design/SKILL.md",
        "agent/skills/interview-coach/SKILL.md",
      ],
      `${packagePath}: complete job-hunt Skill suite is required`,
    );
    const resumeWritingSkill = await readFile(
      join(root, "agent", "skills", "resume-writing", "SKILL.md"),
      "utf8",
    );
    const resumeFocusRubric = await readFile(
      join(root, "agent", "skills", "resume-writing", "references", "focus-rubric.md"),
      "utf8",
    );
    const resumeDesignSkill = await readFile(
      join(root, "agent", "skills", "resume-design", "SKILL.md"),
      "utf8",
    );
    const jobIntelligenceSkill = await readFile(
      join(root, "agent", "skills", "job-intelligence", "SKILL.md"),
      "utf8",
    );
    const interviewCoachSkill = await readFile(
      join(root, "agent", "skills", "interview-coach", "SKILL.md"),
      "utf8",
    );
    const interviewCoachingRubric = await readFile(
      join(root, "agent", "skills", "interview-coach", "references", "coaching-rubric.md"),
      "utf8",
    );
    assert.match(
      resumeWritingSkill,
      /Build the focus brief/,
      `${packagePath}: resume Skill must establish a hiring thesis before drafting`,
    );
    assert.match(
      resumeWritingSkill,
      /score is below 80\/100/,
      `${packagePath}: resume Skill must enforce a minimum focus score`,
    );
    assert.match(
      resumeWritingSkill,
      /job-hunt-hq:job-hunt-workflow/,
      `${packagePath}: resume Skill must coordinate with Panel workflow`,
    );
    assert.match(
      resumeFocusRubric,
      /Six-second scan test/,
      `${packagePath}: resume Skill must include a first-scan audit`,
    );
    assert.match(
      appScript,
      /job-hunt-hq:resume-writing/,
      `${packagePath}: resume Panel actions must explicitly load the focused writer`,
    );
    assert.match(
      resumeDesignSkill,
      /below 85\/100/,
      `${packagePath}: resume design Skill must enforce visual quality`,
    );
    assert.match(
      jobIntelligenceSkill,
      /Every newly discovered formal job remains `inbox`/,
      `${packagePath}: intelligence Skill must preserve triage semantics`,
    );
    assert.match(
      interviewCoachSkill,
      /Classify every gap|Classify gaps/,
      `${packagePath}: interview Skill must classify gaps before roadmaps`,
    );
    assert.match(html, /id="resume-template-select"/, `${packagePath}: resume templates required`);
    assert.match(html, /id="resume-density-select"/, `${packagePath}: resume density required`);
    assert.match(html, /id="resume-export-status"/, `${packagePath}: PDF export receipt required`);
    assert.match(
      appScript,
      /workspace\.exportPdf/,
      `${packagePath}: resume PDF must use the native Host export`,
    );
    assert.match(
      appScript,
      /career-data\/resumes/,
      `${packagePath}: resume PDFs must stay inside the project data directory`,
    );
    assert.match(
      appScript,
      /job-hunt-hq:job-intelligence/,
      `${packagePath}: discovery and research must load job intelligence`,
    );
    assert.match(
      appScript,
      /data-restore-provider-login-id/,
      `${packagePath}: login-required channels must expose an explicit saved-login action`,
    );
    assert.match(
      appScript,
      /credentials\.cookies\.loginAndSave/,
      `${packagePath}: channel login must use the host-owned login-and-save method`,
    );
    assert.match(
      appScript,
      /credentials\.cookies\.restore/,
      `${packagePath}: saved logins must restore through the host boundary`,
    );
    assert.match(
      workflowReference,
      /channel-login\.md/,
      `${packagePath}: channel verification must route saved logins through its safety reference`,
    );
    assert.match(
      channelLoginReference,
      /Never invoke `UseCredential` with a Cookie credential id/,
      `${packagePath}: saved-login workflow must forbid Cookie file materialization`,
    );
    assert.match(
      skill,
      /Never say that a verification state or Trace was written unless that exact/,
      `${packagePath}: workflow Skill must forbid fabricated Panel write receipts`,
    );
    assert.match(
      appScript,
      /job-hunt-hq:interview-coach/,
      `${packagePath}: interview actions must load the coach`,
    );
    assert.match(html, /id="project-context-name"/, `${packagePath}: project status is required`);
    assert.match(
      html,
      /id="project-session-state"/,
      `${packagePath}: session binding status is required`,
    );
    assert.doesNotMatch(
      html,
      /id="view-chat"/,
      `${packagePath}: chat must stay in the CodeShell session`,
    );
    assert.match(
      html,
      /id="session-bridge"/,
      `${packagePath}: contextual Session bridge is required`,
    );
    assert.match(
      html,
      /id="session-instruction"/,
      `${packagePath}: Session instruction composer is required`,
    );
    assert.match(
      html,
      /id="session-prompt-preview"/,
      `${packagePath}: submitted prompt preview is required`,
    );
    assert.match(
      html,
      /id="session-activity-list"/,
      `${packagePath}: Session submission receipts are required`,
    );
    assert.match(
      html,
      /id="session-trace-filters"/,
      `${packagePath}: Session traces must be filterable`,
    );
    assert.match(
      html,
      /data-session-trace-filter="partial"/,
      `${packagePath}: partial Session outcomes must be filterable`,
    );
    for (const id of [
      "application-stage",
      "application-next-action",
      "application-next-action-at",
      "application-note",
      "update-application",
      "application-history",
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `${packagePath}: missing #${id}`);
    }
    assert.match(
      html,
      /(?:data-status-filter="inbox"|<option value="inbox">)/,
      `${packagePath}: discovered jobs need a triage inbox`,
    );
    assert.match(html, /id="inbox-count"/, `${packagePath}: inbox count is required`);
    assert.match(
      html,
      /data-career-flow-action="materials"/,
      `${packagePath}: dashboard must expose the guided career flow`,
    );
    assert.match(
      html,
      /data-job-status-shortcut="active"/,
      `${packagePath}: opportunity panel needs a shortlisted-job shortcut`,
    );
    assert.match(
      html,
      /id="dashboard-focus-secondary"/,
      `${packagePath}: next-best action needs an alternate path`,
    );
    for (const id of [
      "intake-search-sites",
      "intake-import-message",
      "intake-project-files",
      "workflow-disclosure",
      "resume-workspace-slot",
      "reset-job-hunt-project",
      "confirm-reset-job-hunt",
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `${packagePath}: missing #${id}`);
    }
    assert.match(
      skill,
      /recruiter or friend forwards/,
      `${packagePath}: workflow Skill must normalize manual JD intake channels`,
    );
    assert.match(
      skill,
      /hand control to the user for sign-in or\s+CAPTCHA/,
      `${packagePath}: workflow Skill must preserve the interactive login boundary`,
    );
    assert.match(
      appScript,
      /resetJobHuntWorkspace/,
      `${packagePath}: project-bound reset flow is required`,
    );
    assert.match(
      appScript,
      /openJobSearchDialog\(\{ focus: "providers" \}\)/,
      `${packagePath}: the recruiting-site entry must open and focus channel selection`,
    );
    assert.match(
      appScript,
      /isCorruptedSavedLoginError[\s\S]*saved login[\s\S]*corrupted/i,
      `${packagePath}: older Hosts need a friendly corrupted-login fallback`,
    );
    assert.match(
      appScript,
      /保存的登录已失效[\s\S]*重新登录并保存/,
      `${packagePath}: corrupted channel logins need one actionable recovery path`,
    );
    assert.match(appScript, /workspace\.openPath/, `${packagePath}: resume files need open actions`);
    assert.match(
      appScript,
      /workspace\.revealPath/,
      `${packagePath}: resume files need reveal actions`,
    );
    assert.match(
      appScript,
      /refreshResumeMarkdownFiles[\s\S]*job-hunt-resume-/,
      `${packagePath}: saved Markdown resumes must be rediscovered from the project`,
    );
    assert.match(
      appScript,
      /appendResumeInlineMarkdown[\s\S]*document\.createElement\([\s\S]*"strong"/,
      `${packagePath}: resume preview and PDF need safe inline Markdown rendering`,
    );
    assert(
      html.indexOf('class="workbench"') < html.indexOf('id="workflow-builder"'),
      `${packagePath}: users must see jobs before composing downstream tasks`,
    );
    assert.match(
      html,
      /(?:data-status-filter="interview"|<option value="interview">)/,
      `${packagePath}: interview-stage grouping is required`,
    );
    assert.match(
      html,
      /(?:data-status-filter="closed"|<option value="closed">)/,
      `${packagePath}: closed-stage grouping is required`,
    );
    assert.match(
      html,
      /id="save-project-snapshot"/,
      `${packagePath}: failed project writes must be recoverable from the Panel`,
    );
    assert.match(
      appScript,
      /dataset\.triageJobId/,
      `${packagePath}: inbox cards must expose explicit triage actions`,
    );
    assert.match(
      appScript,
      /status: "inbox"/,
      `${packagePath}: imported jobs must default to inbox`,
    );
    assert.match(
      appScript,
      /完整 JD 进入待筛选岗位池也不代表感兴趣或准备投递/,
      `${packagePath}: manual JD import must explain the formal inbox boundary`,
    );
    assert.match(
      appScript,
      /isWorkflowEligibleStage/,
      `${packagePath}: inbox jobs must stay out of downstream task selection`,
    );
    assert.match(
      appScript,
      /function renderCareerFlow/,
      `${packagePath}: career flow must reflect current project state`,
    );
    assert.match(
      appScript,
      /function renderDashboardFocus/,
      `${packagePath}: dashboard needs a state-aware next action`,
    );
    assert.match(
      appScript,
      /function workflowMissingJobTasks/,
      `${packagePath}: job-dependent tasks must be validated before submission`,
    );
    assert.match(
      appScript,
      /function openSessionBridge/,
      `${packagePath}: contextual Session actions are required`,
    );
    assert.match(
      appScript,
      /dataset\.sessionQuestionId/,
      `${packagePath}: interview questions must be actionable in Session`,
    );
    assert.match(
      appScript,
      /function recordSessionSubmission/,
      `${packagePath}: submitted Session instructions must remain visible`,
    );
    assert.match(
      appScript,
      /function recordTraceArtifact/,
      `${packagePath}: Session traces must link written artifacts`,
    );
    assert.match(
      appScript,
      /function latestTraceForArtifact/,
      `${packagePath}: artifacts must resolve their latest generation Trace`,
    );
    assert.match(
      appScript,
      /function inspectSessionTrace/,
      `${packagePath}: artifacts must open their generation Trace`,
    );
    assert.match(
      appScript,
      /function syncActiveTraceLifecycle/,
      `${packagePath}: Session traces must follow the Agent busy lifecycle`,
    );
    assert.match(
      appScript,
      /function activateTraceFromToolArgs/,
      `${packagePath}: writes must resolve their explicit Trace ID`,
    );
    assert.match(
      appScript,
      /function rerunSessionTrace/,
      `${packagePath}: a Trace must be replayable from its original input`,
    );
    assert.match(
      appScript,
      /hostCall\("agent\.submitPrompt", \{ prompt: tracedPrompt, displayText \}\)/,
      `${packagePath}: Panel input must remain visible in the bound Session`,
    );
    assert.match(
      appScript,
      /session-trace-input/,
      `${packagePath}: Trace detail must expose the submitted input`,
    );
    assert.match(
      appScript,
      /data\.traceFeedbackValue|dataset\.traceFeedbackValue/,
      `${packagePath}: Trace results must accept a user evaluation`,
    );
    assert.match(
      appScript,
      /compactPanelLocalState\(state\)/,
      `${packagePath}: local Panel storage must use the bounded UI and Trace payload`,
    );
    assert.match(
      appScript,
      /projectSnapshotSaveInFlight[\s\S]*?projectSnapshotCommittedVersion/,
      `${packagePath}: project snapshot writes must be serialized and coalesced`,
    );
    assert.match(
      appScript,
      /isRateLimit[\s\S]*?waitForRetry/,
      `${packagePath}: burst saves must recover from the host rate limit`,
    );
    assert.match(
      appScript,
      /function generateLocalDraft[\s\S]*?const markdown = composeDraft\(job, category\)/,
      `${packagePath}: preview resume generation must build its draft in scope`,
    );
    assert.match(
      appScript,
      /function buildLocalClaimEvidence[\s\S]*?locator: "user:profile:summary"[\s\S]*?status: "needs_review"/,
      `${packagePath}: candidate profile summaries need a visible but unverified local Source`,
    );
    assert.equal(
      [...appScript.matchAll(/hostCall\("agent\.submitPrompt"/g)].length,
      1,
      `${packagePath}: every Agent launch must use the unified traced submitter`,
    );
    assert.match(
      html,
      /SESSION TRACES/,
      `${packagePath}: Trace timeline must be visible in the Session bridge`,
    );
    assert.match(html, /id="jd-preview"/, `${packagePath}: full JD view is required`);
    for (const field of [
      "keyword",
      "location",
      "seniority",
      "count",
      "freshnessDays",
      "workMode",
      "exclusions",
    ]) {
      assert.match(
        html,
        new RegExp(`name="${field}"`),
        `${packagePath}: discovery field ${field} is required`,
      );
    }
    assert.match(
      appScript,
      /input\.name = "providers"/,
      `${packagePath}: discovery provider choices must render from the channel catalog`,
    );
    assert.match(
      appScript,
      /state\.discoveryPreferences = preferences/,
      `${packagePath}: discovery criteria must persist with the project`,
    );
    assert.match(
      html,
      /id="workflow-job-picker"/,
      `${packagePath}: multi-job task composer is required`,
    );
    assert.match(
      html,
      /id="workflow-task-picker"/,
      `${packagePath}: composable task picker is required`,
    );
    assert.match(
      html,
      /id="preparation-gap-list"/,
      `${packagePath}: preparation plan view is required`,
    );
    for (const id of [
      "resume-category",
      "base-resume-select",
      "tailor-resume",
      "resume-photo-input",
      "resume-evidence-ledger",
      "resume-evidence-list",
      "print-resume",
      "resume-trace",
      "resume-print-root",
      "preparation-gap-summary",
      "preparation-roadmap-count",
      "preparation-roadmap-list",
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `${packagePath}: missing #${id}`);
    }
    assert.match(
      appScript,
      /function buildPublicResumePrintClone[\s\S]*?querySelectorAll\("\.resume-point-proof"\)/,
      `${packagePath}: PDF export must omit internal evidence annotations`,
    );
    assert.match(
      appScript,
      /async function exportResumeToPdf[\s\S]*?workspace\.exportPdf/,
      `${packagePath}: native public resume PDF export is required`,
    );
    assert.match(
      appScript,
      /async function exportResumeToPdf[\s\S]*?state\.resume\.pdfExports[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?导出记录还没有同步到项目/,
      `${packagePath}: PDF receipts must await project persistence and report partial success`,
    );
    assert.match(
      appScript,
      /function escapeResumeHtmlAttribute[\s\S]*?&amp;[\s\S]*?&quot;[\s\S]*?&lt;[\s\S]*?&gt;/,
      `${packagePath}: public Markdown photo attributes must escape candidate identity text`,
    );
    assert.match(
      appScript,
      /function ensureResumePublicationReady[\s\S]*?resumePublicationStatus[\s\S]*?async function saveResumeToRepo[\s\S]*?!ensureResumePublicationReady\(\)[\s\S]*?async function exportResumeToPdf[\s\S]*?!ensureResumePublicationReady\(\)/,
      `${packagePath}: Repo and PDF publication must share the evidence-completeness gate`,
    );
    assert.match(
      appScript,
      /async function saveResumeToRepo[\s\S]*?publicResumeSaved = true[\s\S]*?evidenceLedgerSaved = true[\s\S]*?公开简历已保存到[\s\S]*?内部证据账本未更新/,
      `${packagePath}: two-file resume publication must report partial success accurately`,
    );
    assert.match(
      appScript,
      /resumeEditor\.addEventListener\("input"[\s\S]*?renderResumeEvidence\(\)[\s\S]*?refreshResumePublicationControls\(\)/,
      `${packagePath}: manual Markdown edits must refresh evidence and publication feedback live`,
    );
    assert.match(
      appScript,
      /function renderResumeSaveState[\s\S]*?snapshotConflict[\s\S]*?snapshotSaving[\s\S]*?snapshotDirty[\s\S]*?dataset\.state/,
      `${packagePath}: the resume header must expose honest project save state`,
    );
    assert.match(
      appScript,
      /function reportPanelRuntimeFailure[\s\S]*?已保存到项目的数据不受影响[\s\S]*?addEventListener\("error"[\s\S]*?addEventListener\("unhandledrejection"/,
      `${packagePath}: uncaught Panel failures must become a deduplicated user-visible recovery message`,
    );
    assert.match(
      appScript,
      /function openSystemPdfFallback[\s\S]*?window\.print\(\)/,
      `${packagePath}: legacy PDF fallback is required`,
    );
    const appStyle = await readFile(join(root, "app", "style.css"), "utf8");
    assert.match(appStyle, /@media print/, `${packagePath}: print stylesheet is required`);
    assert.match(appStyle, /@page\s*\{\s*size:\s*A4;/, `${packagePath}: A4 page size is required`);
    assert.match(
      appStyle,
      /body\.printing-resume > :not\(\.resume-print-root\)/,
      `${packagePath}: PDF export must isolate the public resume`,
    );
    assert.match(
      appScript,
      /async function generateBaseDraft/,
      `${packagePath}: Base Resume generation is required`,
    );
    assert.match(
      appScript,
      /async function generateVariantDraft/,
      `${packagePath}: JD Variant generation is required`,
    );
    assert.match(
      appScript,
      /const baseCategories = [\s\S]*?const variantJobIds = new Set[\s\S]*?resumeStageVariantCount\.textContent = String\(variantJobIds\.size\)/,
      `${packagePath}: resume pipeline counts must represent directions and target jobs, not revisions`,
    );
    assert.match(
      appScript,
      /function touchResumePresentation[\s\S]*?allVersions[\s\S]*?state\.resume\.updatedAt = now/,
      `${packagePath}: visual changes must invalidate previously exported PDFs`,
    );
    assert.match(
      appScript,
      /resumeEvidenceCoverage\.textContent = `Source \$\{coverage\.supported\} \/ \$\{coverage\.total\} · 可发布 \$\{coverage\.publishable\}`/,
      `${packagePath}: resume evidence UI must distinguish found sources from publishable claims`,
    );
    assert.match(
      appScript,
      /register\("save_candidate_context"[\s\S]*?previousPublicProfile[\s\S]*?touchResumePresentation\(\{ allVersions: true \}\)/,
      `${packagePath}: profile changes must invalidate PDFs for every resume version`,
    );
    assert.match(appScript, /currentExportStatus\.fresh \? "" : " · 已过期"/);
    assert.match(
      appScript,
      /dataset\.editResumeVariantChangeId[\s\S]*?保存并采用/,
      `${packagePath}: every job-variant change must support an inline user edit`,
    );
    assert.match(
      appScript,
      /JD REQUIREMENT[\s\S]*?jobRequirementRefs[\s\S]*?SOURCE/,
      `${packagePath}: job-variant reviews must show JD alignment separately from candidate evidence`,
    );
    assert.match(
      appScript,
      /function createResumeRevision[\s\S]*?archiveCurrentResume\(\)[\s\S]*?versionId: uid\("resume"\)[\s\S]*?parentVersionId/,
      `${packagePath}: every accepted job-variant decision must create a traceable resume revision`,
    );
    assert.match(
      appScript,
      /resumeEditor\.addEventListener\("input"[\s\S]*?resumeManualEditRevisionStarted[\s\S]*?createResumeRevision[\s\S]*?手动编辑简历正文/,
      `${packagePath}: the first direct editor change must fork an immutable parent revision`,
    );
    assert.match(
      appScript,
      /resumeEditor\.addEventListener\("input"[\s\S]*?retainResumeEditorDraft\(\)[\s\S]*?scheduleProjectSnapshotSave\(\)/,
      `${packagePath}: direct resume edits must be retained locally before the delayed project save`,
    );
    assert.match(
      appScript,
      /async function syncProjectContext[\s\S]*?recoverResumeEditorDraft\(\)[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?已恢复并保存上次未同步的简历正文/,
      `${packagePath}: an unsynced resume draft must recover and durably write after Panel reload`,
    );
    assert.match(
      appScript,
      /snapshotSemanticKey === nextSemanticKey[\s\S]*?clearSyncedResumeEditorDraft\(nextPayload\.resume\)[\s\S]*?workspace\.writeText[\s\S]*?clearSyncedResumeEditorDraft\(nextPayload\.resume\)/,
      `${packagePath}: resume recovery drafts must clear only after a successful or semantic-no-op project save`,
    );
    assert.match(
      appScript,
      /CRITICAL_DRAFT_STORAGE_KEY[\s\S]*?saveCriticalDraftRecovery\(\)[\s\S]*?loadCriticalDraftRecovery\(saved\)/,
      `${packagePath}: critical interview and resume drafts must survive a host-rate-limited reload`,
    );
    assert.match(
      appScript,
      /async function hostCallWithRateLimitRetry[\s\S]*?async function syncProjectContext[\s\S]*?hostCallWithRateLimitRetry\("workspace\.info"[\s\S]*?hostCallWithRateLimitRetry\("workspace\.readText"/,
      `${packagePath}: project initialization reads must recover after a transient Host rate limit`,
    );
    assert.match(
      appScript,
      /reloadProjectConflict\.addEventListener[\s\S]*?state\.resumeDraft = normalizeResumeEditorDraft\(\)[\s\S]*?syncProjectContext\(\{ quiet: false, localStateSource: compactPanelLocalState\(state\) \}\)/,
      `${packagePath}: explicit conflict discard must not restore the abandoned resume draft`,
    );
    assert.match(
      appScript,
      /async function toggleResumeQaSkip[\s\S]*?question\.status = "skipped"[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state\.resume\.candidateQuestions = previousQuestions/,
      `${packagePath}: private resume question status changes must confirm or roll back the project write`,
    );
    assert.match(
      html,
      /id="interview-debrief-list"/,
      `${packagePath}: interview debrief view is required`,
    );
    assert.match(html, /data-resume-mode="jd"/, `${packagePath}: JD display mode is required`);
    assert.match(
      appScript,
      /const PROJECT_STATE_PATH = "job-hunt-panel\.json"/,
      `${packagePath}: project snapshot path is required`,
    );
    assert.match(
      appScript,
      /async function syncProjectContext/,
      `${packagePath}: project sync is required`,
    );
    assert.match(
      appScript,
      /async function writeProjectSnapshot/,
      `${packagePath}: project snapshot writer is required`,
    );
    assert.match(
      appScript,
      /projectSnapshotChangedExternally\(existing\)[\s\S]*?markProjectSnapshotConflict\(existing\)[\s\S]*?return false/,
      `${packagePath}: project writes must stop when the loaded snapshot revision is stale`,
    );
    assert.match(
      appScript,
      /snapshotUnreadable = true[\s\S]*?无法安全读取现有项目快照/,
      `${packagePath}: unreadable existing snapshots must fail closed instead of being replaced`,
    );
    assert.match(
      appScript,
      /snapshotSaveRetryAttempt[\s\S]*?回答文字仍保留/,
      `${packagePath}: rate-limited answer saves must expose visible retry progress`,
    );
    assert.match(
      appScript,
      /setInterval\(\(\) => \{[\s\S]*?checkProjectSnapshotRevision\(\)[\s\S]*?15_000/,
      `${packagePath}: a visible Panel must periodically detect external project updates`,
    );
    assert.match(
      appScript,
      /projectSnapshotNeedsMigration = parsed\.schemaVersion === 1[\s\S]*?await writeProjectSnapshot\(\)/,
      `${packagePath}: a normalized legacy project snapshot must be durably upgraded to v2`,
    );
    assert.match(skill, /CODESHELL\.md/, `${packagePath}: Skill must inspect CODESHELL.md`);
    assert.match(
      skill,
      /absence is not a\s+blocker/,
      `${packagePath}: missing project instructions must not block the workflow`,
    );
    assert.match(
      skill,
      /Never request, reveal, export, or materialize Cookie values/,
      `${packagePath}: Skill must forbid raw credential access and replay`,
    );
    assert.match(
      html,
      /id="search-project-preflight"/,
      `${packagePath}: website discovery must show project preflight`,
    );
    assert.match(
      html,
      /id="search-login-preflight"/,
      `${packagePath}: website discovery must show login preflight`,
    );
    assert.match(
      html,
      /id="source-overview-title"/,
      `${packagePath}: candidate source page needs a recognized-source overview`,
    );
    assert.match(
      html,
      /id="source-base-state"/,
      `${packagePath}: data source overview must separate Base Resume`,
    );
    assert.match(
      html,
      /class="career-flow"[^>]*hidden/,
      `${packagePath}: global workflow must not appear as tabs in the JD pool`,
    );
    assert(
      html.indexOf('id="view-materials"') < html.indexOf('id="source-overview-title"'),
      `${packagePath}: source overview belongs directly to the candidate source page`,
    );
    assert.match(
      appStyle,
      /color-scheme:\s*light/,
      `${packagePath}: main panel theme must remain light`,
    );
    assert.match(html, /id="job-search-query"/, `${packagePath}: JD pool needs direct search`);
    assert.match(
      html,
      /id="job-detail-description"/,
      `${packagePath}: JD pool needs an inline full-description reader`,
    );
    assert.match(
      html,
      /id="job-detail-interest"/,
      `${packagePath}: JD reader needs fixed triage actions`,
    );
    assert.match(
      html,
      /id="delete-job"/,
      `${packagePath}: JD reader needs a visible delete action`,
    );
    assert.match(
      html,
      /id="delete-job-dialog"/,
      `${packagePath}: deleting a JD needs explicit confirmation`,
    );
    assert.match(
      html,
      /id="jd-inbox-panel"/,
      `${packagePath}: project-visible JD inbox is required`,
    );
    assert.match(
      html,
      /id="jd-file-input"[^>]*accept="image\/\*,\.pdf,\.doc,\.docx/,
      `${packagePath}: JD intake must accept screenshots, PDF, and Word files`,
    );
    assert.match(
      html,
      /id="jd-file-input"[^>]*aria-label="选择要导入的 JD 文件或截图"/,
      `${packagePath}: the hidden JD file control needs an accessible name`,
    );
    assert.match(
      appScript,
      /save_jd_intake_results.*不能只留下 Trace/s,
      `${packagePath}: JD intake prompt must require structured outcomes`,
    );
    assert.match(
      appScript,
      /function renderJobPoolDetail/,
      `${packagePath}: JD reader renderer is required`,
    );
    assert.match(
      html,
      /id="channel-verification-list"/,
      `${packagePath}: channel management needs one-provider verification controls`,
    );
    for (const id of [
      "job-leads-panel",
      "job-lead-list",
      "discovery-automation-panel",
      "discovery-automation-form",
      "discovery-automation-status",
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `${packagePath}: missing #${id}`);
    }
    assert.match(
      appScript,
      /job-hunt-hq:scheduled-discovery:v1/,
      `${packagePath}: recurring discovery needs a stable task marker`,
    );
    assert.match(
      appScript,
      /career-data\/discovery\/runs/,
      `${packagePath}: scheduled results need a project-local receipt path`,
    );
    assert.match(
      appScript,
      /automations\.create/,
      `${packagePath}: recurring discovery must use the project-scoped Host automation API`,
    );
    assert.match(
      html,
      /id="view-channels"/,
      `${packagePath}: channels need an independent top-level view`,
    );
    assert.match(
      html,
      /id="show-add-channel"/,
      `${packagePath}: data sources need an explicit add-channel action`,
    );
    assert.match(
      html,
      /id="custom-channel-url"[^>]*type="url"/,
      `${packagePath}: custom channels need a validated URL field`,
    );
    assert.match(
      appScript,
      /data\.removeProviderId|removeProviderId/,
      `${packagePath}: custom channels need an explicit remove action`,
    );
    assert.match(
      appScript,
      /本次唯一渠道.*provider_id=/,
      `${packagePath}: channel verification prompt must be limited to one provider`,
    );
    assert.match(
      appScript,
      /恢复登录并验证/,
      `${packagePath}: saved channel logins need one combined restore-and-verify action`,
    );
    assert.match(
      html,
      /Cookie 直接进入 CodeShell\s+凭证库/,
      `${packagePath}: channel UI must explain host-owned Cookie persistence`,
    );
    assert.match(
      workflowReference,
      /persistent across app restarts/,
      `${packagePath}: channel workflow must preserve the CodeShell browser boundary`,
    );
    assert.match(
      workflowReference,
      /[Nn]ever promise\s+automatic cross-Session reuse/,
      `${packagePath}: channel workflow must not promise cross-session cookie sharing`,
    );
    assert.match(
      appScript,
      /!verification\.allReady/,
      `${packagePath}: website discovery must require verified selected channels`,
    );
    assert.match(
      skill,
      /website-discovery task launched by the Panel requires an initialized/,
      `${packagePath}: Panel website discovery must require initialization`,
    );
    assert.match(
      skill,
      /separate, one-provider task/,
      `${packagePath}: Skill must separate verification from discovery`,
    );
    assert.match(
      skill,
      /first useful panel write early/,
      `${packagePath}: Skill must save progressive results`,
    );
    assert.match(
      skill,
      /panel-app:job-hunt-hq/,
      `${packagePath}: Skill must explain how to invoke its panel tools`,
    );
    assert.match(
      skill,
      /zero, one, or many explicitly shortlisted `job_id`/,
      `${packagePath}: Skill must support zero, one, or many selected jobs`,
    );
    assert.match(
      skill,
      /Presets are shortcuts,\s+not fixed workflows/,
      `${packagePath}: Skill must not force fixed scenarios`,
    );
    assert.match(skill, /Base Resume/, `${packagePath}: Skill must define Base Resume first`);
    assert.match(skill, /base_resume_id/, `${packagePath}: Skill must preserve variant lineage`);
    assert.match(skill, /claim_evidence/, `${packagePath}: Skill must require resume sources`);
    assert.match(
      skill,
      /Panel requests project initialization/,
      `${packagePath}: Skill must route one-click project initialization`,
    );
    assert.match(
      skill,
      /references\/resume-quality\.md/,
      `${packagePath}: Skill must load the resume quality protocol`,
    );
    assert.match(
      skill,
      /sources\[\]\.evidence/,
      `${packagePath}: Skill must explain what every resume source proves`,
    );
    assert.match(skill, /Panel Trace ID/, `${packagePath}: Skill must preserve Trace correlation`);
    assert.match(
      skill,
      /pass that exact ID to every non-readonly/,
      `${packagePath}: Skill must pass trace_id`,
    );
    assert.match(
      skill,
      /finish with `complete_execution_trace`/,
      `${packagePath}: Skill must explicitly finish Panel traces`,
    );
    assert.doesNotMatch(
      html,
      /generate-commit-interview|data-workflow-task="commits"|Commit 深挖题/,
      `${packagePath}: Commit-only question generation must stay out of the user workflow`,
    );
    assert.doesNotMatch(
      appScript,
      /function generateCommitInterviewSet|source_mode=commits/,
      `${packagePath}: the Panel must not retain a hidden Commit-only generator`,
    );
    assert.match(
      html,
      /id="initialize-job-hunt-project"/,
      `${packagePath}: one-click project initialization is required`,
    );
    assert.match(
      appScript,
      /initializeJobHuntProject/,
      `${packagePath}: project initialization must submit through the current Session`,
    );
    assert.match(
      appScript,
      /buildProjectBootstrapTask/,
      `${packagePath}: initialization must use the tested project-bootstrap contract`,
    );
    assert.match(
      workflowReference,
      /## Initialize the current project/,
      `${packagePath}: Skill workflow must define project initialization`,
    );
    assert.match(
      workflowReference,
      /## Update application progress/,
      `${packagePath}: Skill workflow must define application tracking`,
    );
    const resumeTool = manifest.agent.tools.find((tool) => tool.name === "save_resume_draft");
    assert(resumeTool.inputSchema.required.includes("claim_evidence"));
    assert(resumeTool.inputSchema.required.includes("candidate_questions"));
    assert.equal(resumeTool.inputSchema.properties.candidate_questions.minItems, 3);
    assert.equal(resumeTool.inputSchema.properties.candidate_questions.maxItems, 12);
    const claimSchema = resumeTool.inputSchema.properties.claim_evidence.items;
    assert(claimSchema.required.includes("importance"));
    assert(claimSchema.required.includes("why_it_matters"));
    assert(claimSchema.required.includes("interview_questions"));
    assert(claimSchema.properties.sources.items.required.includes("evidence"));
    assert(
      toolNames.has("save_resume_qa_answer"),
      `${packagePath}: candidate resume QA answers need structured write-back`,
    );
    assert.match(
      appScript,
      /register\("save_resume_draft"[\s\S]*?previousDraftState[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state\.resume = previousDraftState\.resume[\s\S]*?recordTraceArtifact/,
      `${packagePath}: Agent resume drafts must roll back before publishing their Trace artifact`,
    );
    assert.match(
      appScript,
      /register\("save_resume_qa_answer"[\s\S]*?previousResume = clone\(state\.resume\)[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state\.resume = previousResume[\s\S]*?recordTraceArtifact/,
      `${packagePath}: Agent resume QA writes must roll back before publishing their Trace artifact`,
    );
    for (const id of [
      "resume-qa-panel",
      "resume-qa-open-count",
      "resume-qa-list",
      "answer-resume-qa",
      "apply-resume-qa",
      "resume-qa-dialog",
      "resume-qa-form",
      "resume-qa-answer",
      "resume-qa-status",
      "resume-qa-source-refs",
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `${packagePath}: missing #${id}`);
    }
    assert.match(
      appScript,
      /async function saveResumeQaEditor[\s\S]*?writeProjectSnapshot\(\)[\s\S]*?openResumeQaEditor\(nextQuestion\)/,
      `${packagePath}: candidate QA must save and advance directly inside the Panel`,
    );
    assert.doesNotMatch(
      appScript,
      /function openResumeQaSession|function openResumeQaBatchSession/,
      `${packagePath}: candidate QA answering must not depend on Session`,
    );
    assert.match(
      resumeWritingSkill,
      /Create private candidate memory QA/,
      `${packagePath}: resume Skill must create private memory prompts`,
    );
    assert.match(
      resumeWritingSkill,
      /Save a usable draft first/,
      `${packagePath}: candidate QA must not block the first editable draft`,
    );
    for (const id of [
      "resume-pipeline",
      "resume-next-action-title",
      "resume-next-action",
      "interview-practice-workspace",
      "interview-bank-workspace",
      "question-bank-list",
      "question-bank-needs-work",
      "question-bank-list-footer",
      "question-bank-visible-count",
      "question-bank-load-more",
      "question-bank-sort",
      "question-bank-result-summary",
      "question-bank-reset-filters",
      "question-bank-dialog",
      "question-bank-editor-readiness",
      "mock-session-list",
      "mock-session-list-footer",
      "mock-session-visible-count",
      "mock-session-load-more",
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `${packagePath}: missing #${id}`);
    }
    assert.match(
      appScript,
      /let questionBankVisibleLimit = 60[\s\S]*?questionBankPage\(visible, questionBankVisibleLimit\)/,
      `${packagePath}: a large canonical bank must render incrementally`,
    );
    assert.match(
      html,
      /data-question-bank-filter="active"[\s\S]*?id="question-bank-sort"[\s\S]*?class="question-bank-editor-section"[\s\S]*?保存并返回题库[\s\S]*?保存并立即练习/,
      `${packagePath}: question-bank management needs status shortcuts, sorting, structured editing, and explicit save decisions`,
    );
    assert.match(
      appScript,
      /function renderQuestionBankEditorReadiness[\s\S]*?questionBankCurationGaps\(draft\)[\s\S]*?practiceButton\.disabled[\s\S]*?questionBankSort\.addEventListener[\s\S]*?questionBankResetFilters\.addEventListener/,
      `${packagePath}: question editing and library filters need immediate visible feedback`,
    );
    assert.match(
      appScript,
      /let mockSessionVisibleLimit = 12[\s\S]*?state\.mockInterviewSessions\.slice\(0, mockSessionVisibleLimit\)[\s\S]*?mockSessionVisibleLimit = Math\.min\(80, mockSessionVisibleLimit \+ 12\)/,
      `${packagePath}: bounded mock-session history must remain incrementally readable`,
    );
    assert.match(
      appScript,
      /\[item\.fingerprint, \.\.\.\(item\.fingerprintAliases \|\| \[\]\)\][\s\S]*?incomingFingerprints\.has\(fingerprint\)/,
      `${packagePath}: imports must surface items merged through a prior wording alias`,
    );
    assert.match(appScript, /bank_question_id 与题单中的 question_id 不一致/);
    assert.match(appScript, /长期题库已达到 \$\{QUESTION_BANK_LIMIT\} 道/);
    assert.match(appScript, /user:question-bank/);
    assert.match(
      appScript,
      /register\("save_interview_question_bank_items"[\s\S]*?normalizeInterviewQuestionSourceRefs\(question\.source_refs[\s\S]*?traceId: activeTrace\(\)\?\.id/,
      `${packagePath}: current-Session imports must persist a stable Trace source`,
    );
    assert.match(appScript, /这场模拟的待回答题目已归档或不存在/);
    assert.match(
      appScript,
      /prioritizeInterviewSetRotation\(set, state\.interviewSets, state\.mockInterviewSessions\)[\s\S]*?inProgressMocksOrphanedBySetRotation[\s\S]*?state\.interviewSets = library\.interviewSets/,
      `${packagePath}: a new practice set must rotate the full bounded library atomically`,
    );
    assert.match(
      appScript,
      /register\("save_interview_question_set"[\s\S]*?prioritizeInterviewSetRotation\(set, state\.interviewSets, state\.mockInterviewSessions\)[\s\S]*?inProgressMocksOrphanedBySetRotation[\s\S]*?state\.interviewSets = library\.interviewSets/,
      `${packagePath}: Agent-generated sets must use the same atomic rotation as preview sets`,
    );
    assert.match(
      appScript,
      /register\("save_interview_question_set"[\s\S]*?previousQuestionSetState[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state\.questionBank = previousQuestionSetState\.questionBank[\s\S]*?recordTraceArtifact/,
      `${packagePath}: generated question sets must roll back before publishing their Trace artifact`,
    );
    assert.match(
      appScript,
      /register\("save_interview_question_bank_items"[\s\S]*?previousQuestionBankState[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state\.questionBank = previousQuestionBankState\.questionBank[\s\S]*?recordTraceArtifact/,
      `${packagePath}: question-bank imports must roll back before publishing their Trace artifact`,
    );
    for (const [tool, checkpoint, rollback, artifact] of [
      [
        "save_channel_verification",
        "previousVerificationState",
        "state.channelVerifications",
        "recordActiveTraceEvent",
      ],
      [
        "save_jd_intake_results",
        "previousIntakeResultState",
        "state.jdIntakeItems",
        "recordTraceArtifact",
      ],
      ["save_candidate_context", "previousCandidateState", "state.profile", "recordTraceArtifact"],
      ["save_job_opportunities", "previousOpportunityState", "state.jobs", "recordTraceArtifact"],
      [
        "update_application_progress",
        "previousApplicationState",
        "state.jobs",
        "recordTraceArtifact",
      ],
      ["save_job_research", "previousResearchState", "state.jobResearch", "recordTraceArtifact"],
      [
        "save_preparation_plan",
        "previousPreparationState",
        "state.preparationPlans",
        "recordTraceArtifact",
      ],
      [
        "save_interview_debrief",
        "previousDebriefState",
        "state.interviewDebriefs",
        "recordTraceArtifact",
      ],
    ]) {
      assert.match(
        appScript,
        new RegExp(
          `register\\("${tool}"[\\s\\S]*?${checkpoint}[\\s\\S]*?await writeProjectSnapshot\\(\\)[\\s\\S]*?${rollback.replaceAll(".", "\\.")} = ${checkpoint}\\.[\\s\\S]*?${artifact}`,
        ),
        `${packagePath}: ${tool} must roll back project state before publishing its Trace outcome`,
      );
    }
    assert.match(
      appScript,
      /async function triageJob[\s\S]*?previousTriageState[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state\.jobs = previousTriageState\.jobs[\s\S]*?岗位状态没有写入项目/,
      `${packagePath}: direct job triage must report success only after a durable project write`,
    );
    assert.match(
      appScript,
      /updateApplication\.addEventListener\("click", async[\s\S]*?previousApplicationState[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state\.jobs = previousApplicationState\.jobs[\s\S]*?投递进度没有写入项目/,
      `${packagePath}: direct application-stage updates must roll back on project write failure`,
    );
    assert.match(
      appScript,
      /resumePhotoInput\.addEventListener\("change", async[\s\S]*?previousPhotoState[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state\.profile = previousPhotoState\.profile[\s\S]*?照片没有写入项目/,
      `${packagePath}: resume photo changes must not claim success before project persistence`,
    );
    assert.match(
      appScript,
      /const updateResumeStyle = async[\s\S]*?previousStyleState[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state\.resume = previousStyleState\.resume[\s\S]*?简历样式没有写入项目/,
      `${packagePath}: resume style changes must be durable before their success notice`,
    );
    assert.match(
      appScript,
      /async function confirmDeleteJob[\s\S]*?previousDeleteState[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state = previousDeleteState\.state[\s\S]*?岗位和关联内容已全部恢复/,
      `${packagePath}: deleting a job and linked artifacts must roll back atomically`,
    );
    assert.match(
      appScript,
      /async function resetJobHuntWorkspace[\s\S]*?previousResetState[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state = previousResetState\.state[\s\S]*?compactPanelLocalState\(state\)/,
      `${packagePath}: a failed workspace reset must restore both project state and local cache`,
    );
    assert.match(
      appScript,
      /async function saveResumeEditorNow[\s\S]*?retainResumeEditorDraft\(\)[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?简历正文已保存到当前项目[\s\S]*?本地恢复草稿/,
      `${packagePath}: explicit resume save must wait for the project and retain a recovery draft on failure`,
    );
    assert.match(
      appScript,
      /async function showChannelVerificationPanel[\s\S]*?previousPreferences[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state\.discoveryPreferences = previousPreferences[\s\S]*?表单仍保留/,
      `${packagePath}: moving from search criteria to channel verification must persist or roll back`,
    );
    assert.match(
      appScript,
      /async function scanProjectJdInbox[\s\S]*?previousScanState[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state\.jdIntakeItems = previousScanState\.jdIntakeItems[\s\S]*?尚未启动识别/,
      `${packagePath}: project-inbox scans must be durable before starting Agent recognition`,
    );
    assert.match(
      html,
      /编辑恢复[\s\S]*?未同步回答与简历正文保留本地草稿/,
      `${packagePath}: materials must explain the bounded local recovery layer`,
    );
    assert.match(
      appScript,
      /item\.status === "inbox" \? "确认并立即练习"[\s\S]*?function practiceBankQuestion[\s\S]*?questionBankCurationGaps\(item\)[\s\S]*?status: "ready"[\s\S]*?state\.interviewWorkspaceMode = "practice"[\s\S]*?startPanelInterview/,
      `${packagePath}: inbox questions must pass curation before direct practice becomes visible`,
    );
    assert.match(
      appScript,
      /async function saveQuestionBankEditor[\s\S]*?previousQuestionBank = clone\(state\.questionBank\)[\s\S]*?正在保存[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state\.questionBank = previousQuestionBank[\s\S]*?表单内容仍保留/,
      `${packagePath}: manual question edits must remain open and roll back on persistence failure`,
    );
    assert.match(
      appScript,
      /async function toggleQuestionBankMastery[\s\S]*?item\.status === "inbox"[\s\S]*?questionBankCurationGaps\(item\)[\s\S]*?origin: "manual"[\s\S]*?status: item\.status === "inbox" \? "ready"[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state\.questionBank = previousQuestionBank/,
      `${packagePath}: inbox questions need an explicit curation transition`,
    );
    assert.match(
      appScript,
      /data-toggle-bank-mastery-id[\s\S]*?void toggleQuestionBankMastery\(item\)/,
      `${packagePath}: question-bank status actions must use the durable transition`,
    );
    assert.match(
      appScript,
      /async function finishPanelInterviewStage[\s\S]*?previousSessions = clone\(state\.mockInterviewSessions\)[\s\S]*?stage\.saving = true[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state\.mockInterviewSessions = previousSessions[\s\S]*?closePanelInterviewStage\(\)/,
      `${packagePath}: completing a mock must persist before the stage closes and roll back on failure`,
    );
    assert.match(
      appScript,
      /async function removeEmptyMockInterviewSession[\s\S]*?previousSessions = clone\(state\.mockInterviewSessions\)[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state\.mockInterviewSessions = previousSessions/,
      `${packagePath}: removing an empty mock must roll back when project persistence fails`,
    );
    assert.match(
      appScript,
      /async function abandonMockInterviewSession[\s\S]*?previousSessions = clone\(state\.mockInterviewSessions\)[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state\.mockInterviewSessions = previousSessions/,
      `${packagePath}: abandoning a mock must roll back when project persistence fails`,
    );
    assert.match(
      appScript,
      /function mockSessionPendingReviewTargets[\s\S]*?practiceSessionId === session\.id[\s\S]*?review\.practiceAttemptId === attempt\.id[\s\S]*?data-score-mock-session-id[\s\S]*?scoreSavedInterviewAnswer\(\{[\s\S]*?attempt: target\.attempt/,
      `${packagePath}: mock history must expose exact attempt-bound scoring for unanswered reviews`,
    );
    assert.match(
      appScript,
      /function practiceableInterviewQuestions[\s\S]*?bankQuestion\?\.status === "ready" \|\| bankQuestion\?\.status === "mastered"/,
      `${packagePath}: practice must select only curated canonical questions`,
    );
    assert.match(
      appScript,
      /register\(\s*"save_interview_practice_review"[\s\S]*?!\["ready", "mastered"\]\.includes\(bankQuestion\.status\)/,
      `${packagePath}: Agent reviews must not bypass the canonical-bank curation gate`,
    );
    assert.match(
      appScript,
      /register\(\s*"save_interview_practice_review"[\s\S]*?previousReviewState[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state\.questionBank = previousReviewState\.questionBank[\s\S]*?recordTraceArtifact/,
      `${packagePath}: review writeback must roll back UI state before publishing its artifact`,
    );
    assert.match(
      appScript,
      /register\("save_mock_interview_session"[\s\S]*?session\.status !== "in_progress"/,
      `${packagePath}: completed mock-session summaries must be immutable`,
    );
    assert.match(
      appScript,
      /register\("save_mock_interview_session"[\s\S]*?previousMockSummaryState[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state\.mockInterviewSessions = previousMockSummaryState\.mockInterviewSessions[\s\S]*?recordTraceArtifact/,
      `${packagePath}: Agent mock summaries must roll back before publishing their Trace artifact`,
    );
    assert.match(
      appScript,
      /const practiceableQuestionIds = \[[\s\S]*?practiceableQuestions\.map\(\(item\) => item\.bankQuestionId\)[\s\S]*?questionIds: practiceableQuestionIds/,
      `${packagePath}: mock sessions must snapshot only practiceable bank IDs`,
    );
    assert.match(
      appScript,
      /scoreSummary: resolveMockSessionScoreSummary\([\s\S]*?args\.status/,
      `${packagePath}: finalization must retain the durable score snapshot when old reviews trim`,
    );
    const questionTool = manifest.agent.tools.find(
      (tool) => tool.name === "save_interview_question_set",
    );
    assert(questionTool.inputSchema.required.includes("source_mode"));
    assert(!questionTool.inputSchema.required.includes("job_id"));
    assert(questionTool.inputSchema.properties.source_mode.enum.includes("aggregate"));
    assert.equal(questionTool.inputSchema.properties.job_ids.minItems, 2);
    assert.equal(questionTool.inputSchema.properties.job_ids.maxItems, 8);
    const questionSchema = questionTool.inputSchema.properties.questions.items;
    assert(questionSchema.required.includes("competency"));
    assert(questionSchema.required.includes("recommended_answer"));
    assert(questionSchema.required.includes("answer_points"));
    assert(questionSchema.required.includes("follow_ups"));
    assert.match(
      interviewCoachSkill,
      /JD-cluster set/,
      `${packagePath}: interview Skill must define aggregate JD training`,
    );
    assert.match(
      interviewCoachSkill,
      /recommended_answer/,
      `${packagePath}: interview Skill must require source-backed practice answers`,
    );
    assert.match(
      interviewCoachSkill,
      /save_interview_practice_review/,
      `${packagePath}: interview Skill must save scored practice reviews`,
    );
    assert.match(
      interviewCoachSkill,
      /Canonical question bank/,
      `${packagePath}: interview Skill must distinguish the durable question bank`,
    );
    assert(
      toolNames.has("save_interview_question_bank_items"),
      `${packagePath}: Session questions need canonical bank import`,
    );
    assert(
      toolNames.has("save_mock_interview_session"),
      `${packagePath}: mock interview sessions need explicit finalization`,
    );
    const mockSessionTool = manifest.agent.tools.find(
      (tool) => tool.name === "save_mock_interview_session",
    );
    assert(!mockSessionTool.inputSchema.properties.score_summary);
    assert(!mockSessionTool.inputSchema.properties.reviewed_question_ids);
    assert.match(interviewCoachingRubric, /Panel derives both/);
    assert.doesNotMatch(
      interviewCoachingRubric,
      /including the exact reviewed canonical question\s+IDs, a score summary/,
    );
    assert.match(workflowReference, /do not send reviewed IDs or score totals/);
    const bankTool = manifest.agent.tools.find(
      (tool) => tool.name === "save_interview_question_bank_items",
    );
    assert.equal(bankTool.inputSchema.properties.questions.minItems, 1);
    assert.equal(bankTool.inputSchema.properties.questions.maxItems, 50);
    assert(bankTool.inputSchema.properties.questions.items.required.includes("question"));
    assert.match(
      appScript,
      /const affectedQuestions = library\.questionBank\.filter[\s\S]*?questionBankIds: affectedIds/,
      `${packagePath}: Session imports must return and reveal the actual merged bank items`,
    );
    const practiceReviewTool = manifest.agent.tools.find(
      (tool) => tool.name === "save_interview_practice_review",
    );
    assert.deepEqual(practiceReviewTool.inputSchema.properties.dimensions.required, [
      "evidence",
      "structure",
      "depth",
      "relevance",
    ]);
    assert(practiceReviewTool.inputSchema.required.includes("optimized_answer"));
    assert.deepEqual(practiceReviewTool.inputSchema.anyOf, [
      { required: ["bank_question_id"] },
      { required: ["interview_set_id", "question_id"] },
    ]);
    assert.match(
      appScript,
      /function renderPracticeReview[\s\S]*?practiceReviews/,
      `${packagePath}: scored practice reviews must render on their question`,
    );
    assert.match(
      appScript,
      /function renderPracticeAttempt[\s\S]*?已保存的回答/,
      `${packagePath}: raw Panel answers must render independently from optional scores`,
    );
    const panelAnswerHandler = appScript.match(
      /async function submitPanelInterviewAnswer\(\)[\s\S]*?\n}\n\nfunction renderQuestionBank/,
    )?.[0];
    assert(panelAnswerHandler, `${packagePath}: Panel answer handler is required`);
    assert.match(
      panelAnswerHandler,
      /writeProjectSnapshot\(\)/,
      `${packagePath}: Panel answers must be written directly to the current project`,
    );
    assert.doesNotMatch(
      panelAnswerHandler,
      /submitSessionTask/,
      `${packagePath}: Panel answers must not create or depend on Session messages`,
    );
    assert.match(
      appStyle,
      /\.practice-score-grid/,
      `${packagePath}: interview score dimensions need a dedicated visual treatment`,
    );
    assert.match(
      html,
      /id="panel-interview-flow-answer"[\s\S]*?id="panel-interview-flow-score"[\s\S]*?id="panel-interview-flow-improve"/,
      `${packagePath}: saved answers need an explicit save → score → improve path`,
    );
    assert.match(
      appScript,
      /buildInterviewQuestionPracticeHistory\(question[\s\S]*?本题练习历史/,
      `${packagePath}: repeated answers need an in-context comparable history`,
    );
    assert.match(
      appStyle,
      /@media \(max-width: 520px\)[\s\S]*?\.question-bank-dialog \.icon-button[\s\S]*?44px[\s\S]*?\.question-bank-dialog footer \.button/,
      `${packagePath}: the mobile question editor needs touch-sized controls`,
    );
    assert(
      html.indexOf('id="interview-question-list"') <
        html.indexOf('class="interview-followup-panel"'),
      `${packagePath}: questions must precede secondary preparation and debrief content`,
    );
    const preparationTool = manifest.agent.tools.find(
      (tool) => tool.name === "save_preparation_plan",
    );
    assert(preparationTool.inputSchema.required.includes("roadmap"));
    assert(preparationTool.inputSchema.properties.gaps.items.required.includes("kind"));
    assert.deepEqual(preparationTool.inputSchema.properties.gaps.items.properties.kind.enum, [
      "profile",
      "evidence",
      "skill",
    ]);
    assert(
      preparationTool.inputSchema.properties.roadmap.items.required.includes("success_criteria"),
    );
    assert.match(
      appScript,
      /dataset\.sessionRoadmapIndex/,
      `${packagePath}: roadmap stages must continue in the current Session`,
    );
    assert.equal(snapshotSchema.properties.schemaVersion.const, 2);
    assert.equal(snapshotSchema.properties.artifactStorage.properties.schemaVersion.const, 1);
    assert.deepEqual(snapshotSchema.properties.artifactStorage.properties.generation.enum, [
      "a",
      "b",
    ]);
    assert.equal(
      snapshotSchema.properties.artifactStorage.properties.shards.maxItems,
      PROJECT_SNAPSHOT_MAX_SHARDS,
    );
    assert.match(
      appScript,
      /prepareProjectSnapshotDocuments\([\s\S]*?writeProjectSnapshotShards\(prepared\.shards\)[\s\S]*?path: PROJECT_STATE_PATH/,
      `${packagePath}: large snapshots must write the inactive shard generation before switching the root index`,
    );
    assert.match(
      appScript,
      /const nextSemanticKey = projectSnapshotSemanticKey\(nextPayload\)[\s\S]*?snapshotSemanticKey === nextSemanticKey/,
      `${packagePath}: semantically identical project snapshots must not be rewritten`,
    );
    assert.match(
      appScript,
      /mockSessionRemainingPracticeQuestionIds\(session\)[\s\S]*?interviewSetId: set\?\.id \|\| ""/,
      `${packagePath}: saved mock sessions must resume from canonical bank questions without requiring the original set`,
    );
    assert.match(
      appScript,
      /removeEmptySession[\s\S]*?mockSessionHasSavedPractice\(session\)[\s\S]*?已自动移除空记录/,
      `${packagePath}: closing an unanswered mock must not leave an empty durable session`,
    );
    assert.match(
      appScript,
      /function latestResumableMockSession[\s\S]*?mockSessionHasSavedPractice\(session\)[\s\S]*?mockSessionRemainingPracticeQuestionIds\(session\)/,
      `${packagePath}: empty historical sessions must not occupy the primary Continue action`,
    );
    assert.match(
      appScript,
      /function useOptimizedInterviewAnswerAsDraft[\s\S]*?retryPanelInterviewQuestion\(\)[\s\S]*?updatePanelInterviewDraft\(\)[\s\S]*?改成自己的表达/,
      `${packagePath}: a scored optimized answer must become a new editable draft without overwriting history`,
    );
    assert.match(
      appScript,
      /function useRecommendedInterviewAnswerAsDraft[\s\S]*?panelInterviewAttempt\(question\)[\s\S]*?retryPanelInterviewQuestion\(\)[\s\S]*?updatePanelInterviewDraft\(\)/,
      `${packagePath}: a project-backed reference answer must start an editable draft without overwriting a prior attempt`,
    );
    assert.match(
      appScript,
      /function openDurableMockInterview[\s\S]*?saving: true[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state\.mockInterviewSessions = previousSessions/,
      `${packagePath}: a new mock must block answering until its durable project record succeeds and roll back on failure`,
    );
    assert.match(
      appScript,
      /async function activateResumeVersion[\s\S]*?clone\(record\)[\s\S]*?resumeRecordId\(item\) !== id[\s\S]*?parentVersionId: id[\s\S]*?revisionReason: "从历史版本恢复"[\s\S]*?await writeProjectSnapshot\(\)[\s\S]*?state\.resume = previousResume/,
      `${packagePath}: restoring history must create an immutable child revision and roll back on write failure`,
    );
    assert.match(
      appScript,
      /AI 评分完成 · \$\{overallScore\} 分 · \$\{scoredQuestionSummary\}/,
      `${packagePath}: an asynchronous score write-back must surface an in-Panel completion notice`,
    );
    assert.match(
      appScript,
      /existingTraceReview[\s\S]*?item\.traceId === reviewTraceId[\s\S]*?item\.practiceAttemptId === practiceAttemptId[\s\S]*?id: existingTraceReview\?\.id/,
      `${packagePath}: retrying one score write in the same Trace must update one review idempotently`,
    );
    assert.match(
      appScript,
      /const root = JSON\.parse\(snapshot\.content\);[\s\S]*?await readProjectSnapshotShards\(root\)[\s\S]*?mergeState/,
      `${packagePath}: project state must hydrate every indexed shard before normalization`,
    );
    assert(snapshotSchema.properties.selectedBaseResumeId);
    assert(snapshotSchema.properties.discoveryPreferences);
    assert(snapshotSchema.properties.channelVerifications);
    assert(!snapshotSchema.required.includes("channelVerifications"));
    assert(snapshotSchema.properties.customProviders);
    assert(!snapshotSchema.required.includes("customProviders"));
    assert(snapshotSchema.properties.jdIntakeItems);
    assert(!snapshotSchema.required.includes("jdIntakeItems"));
    assert(snapshotSchema.properties.jobLeads);
    assert(!snapshotSchema.required.includes("jobLeads"));
    assert(snapshotSchema.properties.discoveryRunReceipts);
    assert(!snapshotSchema.required.includes("discoveryRunReceipts"));
    assert(snapshotSchema.properties.discoveryReceiptCutoff);
    assert(!snapshotSchema.required.includes("discoveryReceiptCutoff"));
    assert(snapshotSchema.required.includes("jobResearch"));
    assert(snapshotSchema.required.includes("workflowRuns"));
    assert(snapshotSchema.required.includes("preparationPlans"));
    assert(snapshotSchema.required.includes("interviewDebriefs"));
    assert.equal(snapshotSchema.properties.interviewDebriefs.maxItems, 80);
    assert.equal(snapshotSchema.properties.interviewDebriefs.items.additionalProperties, false);
    assert.equal(
      snapshotSchema.properties.interviewDebriefs.items.properties.questions.items
        .additionalProperties,
      false,
      `${packagePath}: real interview questions must use a strict durable shape`,
    );
    assert(
      snapshotSchema.properties.interviewDebriefs.items.properties.questions.items.required.includes(
        "reportedFeedback",
      ),
      `${packagePath}: debrief questions must retain reported feedback separately`,
    );
    assert.match(
      appScript,
      /state\.interviewDebriefs\.length >= 80[\s\S]*?真实面试复盘已达到 80 场/,
      `${packagePath}: real debrief capacity must block instead of silently evicting history`,
    );
    assert.doesNotMatch(
      appScript,
      /state\.interviewDebriefs = \[debrief, \.\.\.state\.interviewDebriefs\]\.slice/,
      `${packagePath}: saving a debrief must not truncate the oldest real interview`,
    );
    assert(snapshotSchema.required.includes("questionBank"));
    assert(snapshotSchema.required.includes("mockInterviewSessions"));
    assert.equal(
      snapshotSchema.properties.questionBank.maxItems,
      QUESTION_BANK_LIMIT,
      `${packagePath}: snapshot schema and canonical question-bank capacity must stay aligned`,
    );
    assert.equal(snapshotSchema.properties.interviewSets.maxItems, 20);
    assert.equal(snapshotSchema.properties.interviewSets.items.additionalProperties, false);
    assert.equal(
      snapshotSchema.properties.interviewSets.items.properties.questions.items.additionalProperties,
      false,
    );
    assert(
      snapshotSchema.properties.interviewSets.items.properties.questions.items.required.includes(
        "bankQuestionId",
      ),
    );
    assert.equal(snapshotSchema.properties.resume.$ref, "#/$defs/resumeRecord");
    assert.equal(snapshotSchema.properties.versions.maxItems, 30);
    assert.equal(snapshotSchema.$defs.resumeRecord.additionalProperties, false);
    assert.equal(snapshotSchema.$defs.resumeCandidateQuestion.additionalProperties, false);
    assert.equal(snapshotSchema.$defs.resumeVariantChange.additionalProperties, false);
    assert.equal(
      snapshotSchema.$defs.resumeRecord.properties.variantChanges.items.$ref,
      "#/$defs/resumeVariantChange",
    );
    assert(snapshotSchema.$defs.resumeRecord.required.includes("candidateQuestions"));
    assert(snapshotSchema.$defs.resumeRecord.required.includes("claimEvidence"));
    assert(snapshotSchema.properties.questionBank.items.required.includes("fingerprint"));
    assert(snapshotSchema.properties.questionBank.items.required.includes("fingerprintAliases"));
    assert(snapshotSchema.properties.questionBank.items.required.includes("practiceReviews"));
    assert(snapshotSchema.properties.questionBank.items.required.includes("practiceAttempts"));
    assert.equal(
      snapshotSchema.properties.questionBank.items.properties.practiceAttempts.items
        .additionalProperties,
      false,
      `${packagePath}: raw Panel answers must use a strict durable shape`,
    );
    assert.equal(
      snapshotSchema.properties.questionBank.items.properties.practiceReviews.items
        .additionalProperties,
      false,
      `${packagePath}: practice-review history must use a strict durable shape`,
    );
    assert.equal(snapshotSchema.properties.questionBank.items.properties.revision.minimum, 1);
    const curatedStatusGate = snapshotSchema.properties.questionBank.items.allOf[0].then.properties;
    assert.equal(curatedStatusGate.question.minLength, 8);
    assert.equal(curatedStatusGate.competency.minLength, 1);
    assert.equal(curatedStatusGate.sourceRefs.minItems, 1);
    assert.equal(curatedStatusGate.category.not.const, "待分类");
    const importedInboxGate = snapshotSchema.properties.questionBank.items.allOf[1];
    assert.deepEqual(importedInboxGate.if.properties.origin.enum, [
      "session",
      "imported",
      "real_interview",
    ]);
    assert.equal(importedInboxGate.then.properties.status.const, "inbox");
    assert(
      snapshotSchema.properties.mockInterviewSessions.items.required.includes(
        "reviewedQuestionIds",
      ),
    );
    assert(
      snapshotSchema.properties.mockInterviewSessions.items.required.includes(
        "answeredQuestionIds",
      ),
    );
    assert(
      snapshotSchema.properties.mockInterviewSessions.items.required.includes("questionCount"),
    );
    assert.equal(
      snapshotSchema.properties.mockInterviewSessions.items.properties.questionCount.maximum,
      40,
    );
    assert(snapshotSchema.properties.mockInterviewSessions.items.required.includes("scoreSummary"));

    const { assessJobOpportunity, upsertJobDiscovery, upsertJobOpportunities } = await import(
      pathToFileURL(join(root, "app", "job-opportunities.mjs"))
    );
    const listing = {
      id: "job-existing",
      company: "Example",
      title: "Frontend Engineer",
      location: "Shanghai",
      sourceId: "boss",
      url: "https://example.test/jobs/1",
      description: "Short listing",
      jdCompleteness: "partial",
      status: "saved",
      application: {
        nextAction: "Review full JD",
        nextActionAt: "2026-01-03",
        history: [],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const fullJd = {
      ...listing,
      id: "job-incoming",
      description: "Complete role responsibilities and requirements",
      jdCompleteness: "full",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    const keyByUrl = (job) => job.url;
    const keyByMetadata = (job) => [job.sourceId, job.company, job.title, job.location].join("|");
    const progressiveResult = upsertJobOpportunities([listing], [fullJd], {
      dedupeKey: keyByUrl,
      metadataKey: keyByMetadata,
    });
    assert.equal(progressiveResult.jobs.length, 1);
    assert.equal(progressiveResult.inserted.length, 0);
    assert.equal(progressiveResult.updated, 1);
    assert.equal(progressiveResult.jobs[0].id, "job-existing");
    assert.equal(progressiveResult.jobs[0].jdCompleteness, "full");
    assert.equal(progressiveResult.jobs[0].description, fullJd.description);
    assert.equal(progressiveResult.jobs[0].application.nextAction, "Review full JD");

    const shortCandidate = {
      ...listing,
      id: "lead-1",
      description: "负责前端开发；要求熟悉 React。",
      jdCompleteness: "partial",
      status: "inbox",
    };
    const firstDiscovery = upsertJobDiscovery([], [], [shortCandidate], {
      dedupeKey: keyByUrl,
      metadataKey: keyByMetadata,
    });
    assert.equal(firstDiscovery.jobs.length, 0);
    assert.equal(firstDiscovery.leads.length, 1);
    assert.equal(firstDiscovery.leads[0].id, "lead-1");
    assert.equal(assessJobOpportunity(shortCandidate).isFormal, false);
    const completeDescription = [
      "岗位职责：负责 AI 产品前端架构、复杂交互、状态管理和性能治理；参与需求分析、方案评审、测试、发布和线上问题复盘；推动组件体系、监控体系和工程规范建设；与产品、设计和算法团队协作交付。",
      "任职要求：三年以上前端经验，熟练掌握 React、TypeScript、浏览器原理与工程化工具；能够独立完成技术方案、质量验证和跨团队推动；具备清晰沟通、问题排查和结果复盘能力；有 Electron、Node.js 或 AI 应用经验优先。",
      "其他说明：岗位为正式全职，候选人需要能够说明真实项目所有权、技术取舍、验证指标和失败案例。",
    ].join("");
    const completeCandidate = {
      ...shortCandidate,
      id: "incoming-full",
      description: completeDescription,
      jdCompleteness: "full",
      fetchedAt: "2026-08-07T00:00:00.000Z",
    };
    assert.equal(assessJobOpportunity(completeCandidate).isFormal, true);
    const promotedDiscovery = upsertJobDiscovery(
      firstDiscovery.jobs,
      firstDiscovery.leads,
      [completeCandidate],
      { dedupeKey: keyByUrl, metadataKey: keyByMetadata },
    );
    assert.equal(promotedDiscovery.jobs.length, 1);
    assert.equal(promotedDiscovery.leads.length, 0);
    assert.equal(promotedDiscovery.jobs[0].id, "lead-1");
    assert.equal(promotedDiscovery.promoted.length, 1);

    const { jobRemovalPreview, removeJobAndLinkedArtifacts } = await import(
      pathToFileURL(join(root, "app", "job-removal-model.mjs"))
    );
    const removalState = {
      jobs: [{ id: "job-trash" }, { id: "job-keep" }],
      selectedJobId: "job-trash",
      workflowJobIds: ["job-trash", "job-keep"],
      jobResearch: [{ id: "research-trash", jobId: "job-trash" }],
      resume: {
        versionId: "variant-current",
        kind: "variant",
        jobId: "job-trash",
        style: { template: "editorial", density: "comfortable" },
      },
      selectedBaseResumeId: "base-keep",
      versions: [
        { id: "base-keep", kind: "base", jobId: "", markdown: "base" },
        { id: "variant-old", kind: "variant", jobId: "job-trash" },
      ],
      interviewSets: [{ id: "set-trash", jobId: "job-trash" }],
      questionBank: [
        {
          id: "bank-retained",
          jobIds: ["job-trash", "job-keep"],
          sourceSetIds: ["set-trash", "set-keep"],
          sourceRefs: ["real-interview:debrief-trash", "commit:keep"],
        },
        {
          id: "bank-debrief-only",
          question: "What did you learn from this interview round?",
          category: "Behavioral",
          competency: "Reflection",
          status: "mastered",
          jobIds: ["job-trash"],
          sourceSetIds: [],
          sourceRefs: ["real-interview:debrief-trash"],
        },
      ],
      mockInterviewSessions: [
        { id: "mock-trash", interviewSetId: "set-trash" },
        { id: "mock-keep", interviewSetId: "set-keep" },
      ],
      selectedInterviewSetId: "set-trash",
      preparationPlans: [{ id: "plan-trash", jobId: "job-trash" }],
      interviewDebriefs: [{ id: "debrief-trash", jobId: "job-trash" }],
    };
    assert.equal(jobRemovalPreview(removalState, "job-trash").linkedArtifactCount, 7);
    const removedJob = removeJobAndLinkedArtifacts(removalState, "job-trash", {
      kind: "base",
      jobId: "",
      style: {},
    });
    assert.equal(removedJob.next.jobs.length, 1);
    assert.equal(removedJob.next.selectedJobId, "job-keep");
    assert.deepEqual(removedJob.next.workflowJobIds, ["job-keep"]);
    assert.equal(removedJob.next.resume.kind, "base");
    assert.equal(removedJob.next.resume.versionId, "base-keep");
    assert.equal(removedJob.next.versions.length, 0);
    assert.equal(removedJob.next.jobResearch.length, 0);
    assert.equal(removedJob.next.interviewSets.length, 0);
    assert.deepEqual(removedJob.next.questionBank[0].jobIds, ["job-keep"]);
    assert.deepEqual(removedJob.next.questionBank[0].sourceSetIds, []);
    assert.deepEqual(removedJob.next.questionBank[0].sourceRefs, ["commit:keep"]);
    assert.equal(removedJob.next.questionBank[1].status, "inbox");
    assert.deepEqual(removedJob.next.questionBank[1].sourceRefs, []);
    assert.equal(removedJob.next.mockInterviewSessions.length, 0);
    assert.equal(removedJob.next.preparationPlans.length, 0);
    assert.equal(removedJob.next.interviewDebriefs.length, 0);
    const aggregatePreview = jobRemovalPreview(
      {
        jobs: [{ id: "job-trash" }, { id: "job-keep" }],
        interviewSets: [
          { id: "set-aggregate", sourceMode: "aggregate", jobIds: ["job-trash", "job-keep"] },
        ],
      },
      "job-trash",
    );
    assert.equal(
      aggregatePreview.counts.interviewSets,
      0,
      `${packagePath}: a multi-job set must survive removal while another target remains`,
    );
    assert.equal(
      aggregatePreview.adjustments.interviewSetsReScoped,
      1,
      `${packagePath}: deletion preview must disclose retained sets that will be re-scoped`,
    );
    const aggregateRemoval = removeJobAndLinkedArtifacts(
      {
        jobs: [{ id: "job-trash" }, { id: "job-keep" }],
        interviewSets: [
          {
            id: "set-aggregate",
            sourceMode: "aggregate",
            jobId: "",
            jobIds: ["job-trash", "job-keep"],
          },
        ],
        mockInterviewSessions: [
          { id: "mock-aggregate", interviewSetId: "set-aggregate", status: "in_progress" },
        ],
      },
      "job-trash",
    );
    assert.deepEqual(aggregateRemoval.next.interviewSets[0], {
      id: "set-aggregate",
      sourceMode: "jd",
      jobId: "job-keep",
      jobIds: ["job-keep"],
    });
    assert.equal(aggregateRemoval.next.mockInterviewSessions[0].id, "mock-aggregate");

    const { JD_INBOX_PATH, jdIntakeCounts, normalizeJdIntakeItems, upsertJdIntakeItems } =
      await import(pathToFileURL(join(root, "app", "jd-intake-model.mjs")));
    assert.equal(JD_INBOX_PATH, "career-data/jd/inbox");
    const intakeItems = normalizeJdIntakeItems([
      {
        id: "intake-image",
        sourceKind: "image",
        originalName: "wechat.png",
        sourcePath: "career-data/jd/inbox/wechat.png",
        status: "staged",
        receivedAt: "2026-08-07T00:00:00.000Z",
      },
      { id: "invalid", sourcePath: "" },
    ]);
    assert.equal(intakeItems.length, 1);
    const completedIntake = upsertJdIntakeItems(intakeItems, [
      {
        ...intakeItems[0],
        status: "imported",
        jobIds: ["job-keep"],
        summary: "识别出 1 个岗位",
      },
    ]);
    assert.equal(completedIntake.length, 1);
    assert.equal(completedIntake[0].status, "imported");
    assert.deepEqual(jdIntakeCounts(completedIntake), {
      total: 1,
      pending: 0,
      imported: 1,
      attention: 0,
    });

    const {
      normalizeCustomProviders,
      normalizeChannelVerifications,
      normalizeDiscoveryPreferences,
      resolveChannelVerificationForSession,
      resolveJobRecency,
    } = await import(pathToFileURL(join(root, "app", "discovery-model.mjs")));
    const customProviders = normalizeCustomProviders(
      [
        { label: "Acme Careers", url: "https://careers.acme.test/jobs?utm_source=x" },
        { label: "重复网址", url: "https://careers.acme.test/jobs" },
        { label: "不安全网址", url: "http://jobs.invalid.test" },
      ],
      { reservedProviderIds: ["boss", "official"] },
    );
    assert.deepEqual(customProviders, [
      {
        id: "custom-careers-acme-test",
        label: "Acme Careers",
        domain: "careers.acme.test/jobs",
        url: "https://careers.acme.test/jobs",
        custom: true,
      },
    ]);
    const inferredDiscovery = normalizeDiscoveryPreferences(
      {
        location: "上海 / 远程",
        seniority: "5–10 年",
        count: 10,
        providers: ["boss", "invalid", "official", "boss"],
        freshnessDays: 14,
        workMode: "hybrid",
        exclusions: "外包、销售岗",
      },
      {
        profile: { target: "AI 应用工程师" },
        validProviderIds: ["boss", "linkedin", "official"],
      },
    );
    assert.equal(inferredDiscovery.keyword, "AI 应用工程师");
    assert.deepEqual(inferredDiscovery.providers, ["boss", "official"]);
    assert.equal(inferredDiscovery.freshnessDays, 14);
    assert.equal(inferredDiscovery.workMode, "hybrid");
    assert.equal(inferredDiscovery.exclusions, "外包、销售岗");
    const fallbackDiscovery = normalizeDiscoveryPreferences(
      { providers: ["invalid"], count: 999, workMode: "everywhere" },
      {
        profile: { role: "前端工程师" },
        validProviderIds: ["boss", "official"],
      },
    );
    assert.equal(fallbackDiscovery.keyword, "前端工程师");
    assert.deepEqual(fallbackDiscovery.providers, ["boss", "official"]);
    assert.deepEqual(
      normalizeDiscoveryPreferences({ providers: [] }, { validProviderIds: ["boss", "official"] })
        .providers,
      [],
    );
    assert.equal(fallbackDiscovery.count, 8);
    assert.equal(fallbackDiscovery.workMode, "any");
    const normalizedVerifications = normalizeChannelVerifications(
      [
        {
          providerId: "boss",
          state: "login_required",
          checkedAt: "2026-08-06T00:00:00.000Z",
          sessionId: "session-old",
          detail: "需要登录",
        },
        {
          providerId: "invalid",
          state: "ready",
          sessionId: "session-current",
        },
        {
          providerId: "boss",
          state: "ready",
          checkedAt: "2026-08-07T00:00:00.000Z",
          sessionId: "session-current",
          detail: "职位搜索页可用",
        },
      ],
      ["boss", "official"],
    );
    assert.equal(normalizedVerifications.length, 1);
    assert.equal(
      resolveChannelVerificationForSession("boss", normalizedVerifications, "session-current")
        .state,
      "ready",
    );
    assert.equal(
      resolveChannelVerificationForSession("boss", normalizedVerifications, "session-new").state,
      "stale",
    );
    assert.equal(
      resolveChannelVerificationForSession("official", normalizedVerifications, "session-current")
        .state,
      "unchecked",
    );
    assert.deepEqual(
      resolveJobRecency(
        { publishedAt: "2026-08-04T00:00:00.000Z" },
        Date.parse("2026-08-06T00:00:00.000Z"),
      ),
      { state: "fresh", label: "2 天前发布", source: "published" },
    );
    assert.deepEqual(
      resolveJobRecency(
        { fetchedAt: "2026-06-01T00:00:00.000Z" },
        Date.parse("2026-08-06T00:00:00.000Z"),
      ),
      { state: "stale", label: "66 天前核验", source: "fetched" },
    );

    const {
      APPLICATION_STAGE_LABELS,
      applicationStatusMatchesFilter,
      isWorkflowEligibleStage,
      normalizeJobApplication,
      updateApplicationProgress,
    } = await import(pathToFileURL(join(root, "app", "application-model.mjs")));
    const discoveredApplication = normalizeJobApplication({ id: "job-discovered" });
    assert.equal(discoveredApplication.status, "inbox");
    assert.equal(APPLICATION_STAGE_LABELS.inbox, "待筛选");
    assert.equal(APPLICATION_STAGE_LABELS.saved, "感兴趣");
    assert.equal(applicationStatusMatchesFilter("inbox", "inbox"), true);
    assert.equal(applicationStatusMatchesFilter("saved", "active"), true);
    assert.equal(applicationStatusMatchesFilter("tailoring", "active"), true);
    assert.equal(applicationStatusMatchesFilter("archived", "active"), false);
    assert.equal(isWorkflowEligibleStage("inbox"), false);
    assert.equal(isWorkflowEligibleStage("saved"), true);
    assert.equal(isWorkflowEligibleStage("archived"), false);
    assert.equal(
      normalizeJobApplication({ id: "agent-job-legacy", status: "saved" }).status,
      "inbox",
    );
    assert.equal(
      normalizeJobApplication({
        id: "agent-job-reviewed",
        status: "saved",
        application: {
          history: [{ id: "triage-1", stage: "saved", note: "User shortlisted" }],
        },
      }).status,
      "saved",
    );
    const legacyApplication = normalizeJobApplication({
      id: "job-legacy",
      status: "applied",
    });
    assert.equal(legacyApplication.status, "applied");
    assert.deepEqual(legacyApplication.application.history, []);
    assert.equal(APPLICATION_STAGE_LABELS.interviewing, "面试中");
    const firstProgress = updateApplicationProgress(
      legacyApplication,
      {
        status: "screening",
        note: "Recruiter scheduled a screening call.",
        nextAction: "Prepare recruiter questions",
        nextActionAt: "2026-08-08",
      },
      {
        eventId: "application-1",
        source: "agent",
        now: "2026-08-06T10:00:00.000Z",
      },
    );
    assert.equal(firstProgress.changed, true);
    assert.equal(firstProgress.job.status, "screening");
    assert.equal(firstProgress.job.application.history.length, 1);
    assert.equal(firstProgress.job.application.history[0].source, "agent");
    const noteOnlyProgress = updateApplicationProgress(
      firstProgress.job,
      { status: "screening", note: "Confirmed video call link." },
      {
        eventId: "application-2",
        source: "user",
        now: "2026-08-07T10:00:00.000Z",
      },
    );
    assert.equal(noteOnlyProgress.job.application.nextAction, "Prepare recruiter questions");
    assert.equal(noteOnlyProgress.job.application.nextActionAt, "2026-08-08");
    assert.equal(noteOnlyProgress.job.application.history.length, 2);
    assert.equal(applicationStatusMatchesFilter("screening", "interview"), true);
    assert.equal(applicationStatusMatchesFilter("interviewing", "interview"), true);
    assert.equal(applicationStatusMatchesFilter("rejected", "closed"), true);
    assert.equal(applicationStatusMatchesFilter("offer", "closed"), false);

    const { resolveCareerCurrentStep, resolveDashboardFocusKind } = await import(
      pathToFileURL(join(root, "app", "workflow-model.mjs"))
    );
    assert.equal(resolveCareerCurrentStep({ projectReady: false }), "materials");
    assert.equal(resolveCareerCurrentStep({ projectReady: true, hasBase: false }), "base");
    assert.equal(resolveCareerCurrentStep({ projectReady: true, hasBase: true }), "inbox");
    assert.equal(
      resolveCareerCurrentStep({
        projectReady: true,
        hasBase: true,
        totalJobs: 4,
        inboxCount: 2,
        eligibleCount: 2,
      }),
      "inbox",
    );
    assert.equal(
      resolveCareerCurrentStep({
        projectReady: true,
        hasBase: true,
        totalJobs: 2,
        eligibleCount: 2,
      }),
      "preparation",
    );
    assert.equal(
      resolveDashboardFocusKind({ bootstrapState: "ready", hasBase: false }),
      "foundation",
    );
    assert.equal(
      resolveDashboardFocusKind({
        bootstrapState: "ready",
        hasBase: true,
        inboxCount: 3,
        eligibleCount: 1,
      }),
      "inbox",
    );
    assert.equal(
      resolveDashboardFocusKind({
        bootstrapState: "ready",
        hasBase: true,
        hasNextApplication: true,
        eligibleCount: 1,
      }),
      "followup",
    );
    assert.equal(
      resolveDashboardFocusKind({
        bootstrapState: "ready",
        hasBase: true,
        eligibleCount: 2,
        selectedCount: 1,
        selectedTaskCount: 1,
      }),
      "run",
    );
    assert.equal(
      resolveDashboardFocusKind({
        bootstrapState: "ready",
        hasBase: true,
        eligibleCount: 2,
        selectedCount: 1,
        selectedTaskCount: 0,
      }),
      "compose",
    );

    const { normalizePreparationGapKind, normalizeRoadmapMilestone, preparationGapCounts } =
      await import(pathToFileURL(join(root, "app", "roadmap-model.mjs")));
    assert.equal(
      normalizePreparationGapKind(undefined, {
        area: "工作经历时间",
        actions: ["请本人补齐任职年月"],
      }),
      "profile",
    );
    assert.equal(
      normalizePreparationGapKind(undefined, {
        area: "系统设计能力",
        actions: ["学习容量估算并完成一个项目实战"],
      }),
      "skill",
    );
    assert.equal(
      normalizePreparationGapKind(undefined, {
        area: "性能结果",
        actions: ["回查基线和 Commit Source"],
      }),
      "evidence",
    );
    assert.deepEqual(
      preparationGapCounts([
        { kind: "profile" },
        { kind: "evidence" },
        { kind: "skill" },
        { area: "量化结果", actions: ["补 Source"] },
      ]),
      { profile: 1, evidence: 2, skill: 1 },
    );
    assert.deepEqual(
      normalizeRoadmapMilestone(
        {
          phase: "Week 1",
          title: "Build evaluation basics",
          kind: "foundation",
          duration: "3 days",
          tasks: ["Read", "", "Practice"],
          deliverable: "Evaluation note",
          success_criteria: ["Explain the loop"],
          status: "in_progress",
        },
        0,
      ),
      {
        phase: "Week 1",
        title: "Build evaluation basics",
        kind: "foundation",
        duration: "3 days",
        objective: "",
        tasks: ["Read", "Practice"],
        deliverable: "Evaluation note",
        successCriteria: ["Explain the loop"],
        status: "in_progress",
      },
    );

    const {
      baseResumeRecords,
      collectResumeRecords,
      decideResumeVariantChange,
      deriveResumeVariantChanges,
      editResumeVariantChange,
      extractResumeClaims,
      hasActionableResumeContact,
      isSupportedResumePhoto,
      mergeResumeQaQuestions,
      normalizeClaimEvidence,
      normalizeResumeRecord,
      normalizeResumeQaQuestion,
      normalizeResumeQaQuestions,
      normalizeResumeStyle,
      normalizeResumeVariantChanges,
      pendingResumeVariantChangeCount,
      resumeClaimStrength,
      resumeEvidenceCoverage,
      resumeDocumentPublicationGaps,
      resumeExportStatus,
      resumePublicationStatus,
      resumeProfilePublicationGaps,
      resumeQaCounts,
      removeResumeVersion,
      resumeVersionRemovalPreview,
      resolveResumePipelineStep,
      selectResumeQaClaims,
      selectBaseResume,
      updateResumeQaAnswer,
    } = await import(pathToFileURL(join(root, "app", "resume-model.mjs")));
    const legacyBase = normalizeResumeRecord(
      { versionId: "resume-base", markdown: "# Base", updatedAt: "2026-01-01" },
      { profileTarget: "Frontend" },
    );
    const legacyVariant = normalizeResumeRecord({
      versionId: "resume-variant",
      jobId: "job-existing",
      markdown: "# Variant",
      updatedAt: "2026-01-02",
    });
    assert.equal(legacyBase.kind, "base");
    assert.equal(legacyBase.category, "Frontend");
    assert.equal(legacyBase.parentVersionId, "");
    assert.equal(legacyBase.revisionReason, "");
    assert.equal(legacyVariant.kind, "variant");
    assert.equal(legacyVariant.jobId, "job-existing");
    assert.deepEqual(legacyBase.style, {
      template: "editorial",
      density: "comfortable",
    });
    assert.deepEqual(normalizeResumeStyle({ template: "minimal", density: "compact" }), {
      template: "minimal",
      density: "compact",
    });
    assert.deepEqual(normalizeResumeStyle({ template: "unknown", density: "tiny" }), {
      template: "editorial",
      density: "comfortable",
    });
    assert.deepEqual(
      normalizeResumeRecord({
        markdown: "# Resume",
        pdfExports: [
          {
            path: "career-data/resumes/base.pdf",
            exportedAt: "2026-08-06T10:00:00.000Z",
            size: 4096,
          },
          { path: "career-data/resumes/not-a-pdf.txt", size: -1 },
        ],
      }).pdfExports,
      [
        {
          path: "career-data/resumes/base.pdf",
          exportedAt: "2026-08-06T10:00:00.000Z",
          size: 4096,
        },
      ],
    );
    const boundedResume = normalizeResumeRecord({
      id: "i".repeat(150),
      versionId: "v".repeat(150),
      title: "t".repeat(180),
      markdown: "m".repeat(50020),
      notes: ["keep", "keep", "n".repeat(350)],
      candidateQuestions: [
        {
          question: "Which result can you verify?",
          source_hints: ["release notes", "release notes"],
          source_refs: ["file:result.md", "file:result.md"],
        },
      ],
      updatedAt: "u".repeat(120),
    });
    assert.equal(boundedResume.id.length, 100);
    assert.equal(boundedResume.versionId.length, 100);
    assert.equal(boundedResume.title.length, 120);
    assert.equal(boundedResume.markdown.length, 50000);
    assert.deepEqual(boundedResume.notes, ["keep", "n".repeat(300)]);
    assert.deepEqual(boundedResume.candidateQuestions[0].sourceHints, ["release notes"]);
    assert.deepEqual(boundedResume.candidateQuestions[0].sourceRefs, ["file:result.md"]);
    assert.equal(boundedResume.updatedAt.length, 80);
    const mergedClaimEvidence = normalizeClaimEvidence([
      {
        claim: "Built a resilient workflow",
        status: "needs_review",
        importance: "supporting",
        why_it_matters: "Shows ownership",
        sources: [
          { kind: "file", label: "Design", locator: "file:design.md", evidence: "Design boundary" },
        ],
        interview_questions: [{ question: "Why this boundary?", focus: "Trade-off" }],
      },
      {
        claim: "Built a resilient workflow",
        status: "verified",
        importance: "core",
        sources: [
          {
            kind: "commit",
            label: "Implementation",
            locator: "commit:abc1234",
            evidence: "Recovery code",
          },
        ],
        interview_questions: [{ question: "How did you validate recovery?", focus: "Result" }],
      },
      {
        claim: "Built a resilient workflow.",
        sources: [
          {
            kind: "commit",
            label: "Same implementation",
            locator: "COMMIT:ABC1234",
            evidence: "Recovery tests",
          },
        ],
      },
    ]);
    assert.equal(mergedClaimEvidence.length, 1);
    assert.equal(mergedClaimEvidence[0].status, "verified");
    assert.equal(mergedClaimEvidence[0].importance, "core");
    assert.equal(mergedClaimEvidence[0].sources.length, 2);
    assert.match(
      mergedClaimEvidence[0].sources.find((source) => source.kind === "commit").evidence,
      /Recovery code；Recovery tests/,
      "the evidence ledger should merge details for the same source locator",
    );
    assert.equal(mergedClaimEvidence[0].interviewQuestions.length, 2);
    assert.equal(
      normalizeClaimEvidence([
        {
          claim: "Built services in C++",
          sources: [{ kind: "file", label: "C++", locator: "file:cpp", evidence: "C++" }],
        },
        {
          claim: "Built services in C",
          sources: [{ kind: "file", label: "C", locator: "file:c", evidence: "C" }],
        },
      ]).length,
      2,
      "evidence matching must preserve meaningful programming-language symbols",
    );
    const resumeRecords = collectResumeRecords(legacyVariant, [legacyBase, legacyVariant]);
    assert.equal(resumeRecords.length, 2);
    assert.deepEqual(
      baseResumeRecords(resumeRecords).map((resume) => resume.versionId),
      ["resume-base"],
    );
    assert.equal(selectBaseResume(resumeRecords, "resume-base")?.versionId, "resume-base");
    const referencedBase = normalizeResumeRecord({
      versionId: "base-referenced",
      kind: "base",
      category: "Frontend",
      title: "Referenced Base",
      markdown: "# Referenced Base",
      updatedAt: "2026-01-01",
    });
    const activeVariant = normalizeResumeRecord({
      versionId: "variant-current",
      kind: "variant",
      category: "Frontend",
      baseResumeId: "base-referenced",
      jobId: "job-current",
      title: "Current Variant",
      markdown: "# Current Variant",
      updatedAt: "2026-01-03",
    });
    const blockedBaseRemoval = resumeVersionRemovalPreview(
      activeVariant,
      [referencedBase],
      "base-referenced",
    );
    assert.equal(blockedBaseRemoval.removable, false);
    assert.equal(blockedBaseRemoval.reason, "base_in_use");
    assert.equal(blockedBaseRemoval.dependentVariants.length, 1);
    assert.equal(
      removeResumeVersion(activeVariant, [referencedBase], "base-referenced").removed,
      null,
      "a Base revision used by a job variant must not leave a dangling source reference",
    );
    const baseRoot = normalizeResumeRecord({
      versionId: "base-root",
      kind: "base",
      category: "Frontend",
      title: "Base Root",
      markdown: "# Base Root",
      updatedAt: "2026-01-01",
    });
    const baseHistory = normalizeResumeRecord({
      versionId: "base-history",
      parentVersionId: "base-root",
      kind: "base",
      category: "Frontend",
      title: "Base History",
      markdown: "# Base History",
      updatedAt: "2026-01-02",
    });
    const activeBaseRevision = normalizeResumeRecord({
      versionId: "base-current",
      parentVersionId: "base-history",
      kind: "base",
      category: "Frontend",
      title: "Base Current",
      markdown: "# Base Current",
      updatedAt: "2026-01-03",
    });
    assert.equal(
      resumeVersionRemovalPreview(
        activeBaseRevision,
        [baseHistory, baseRoot],
        "base-current",
      ).reason,
      "current",
      "the active resume revision must never be deleted from the history library",
    );
    const removedBaseHistory = removeResumeVersion(
      activeBaseRevision,
      [baseHistory, baseRoot],
      "base-history",
      "base-history",
    );
    assert.equal(removedBaseHistory.removed.versionId, "base-history");
    assert.equal(removedBaseHistory.active.parentVersionId, "base-root");
    assert.equal(removedBaseHistory.selectedBaseResumeId, "base-current");
    assert.equal(removedBaseHistory.reconnectedRevisionCount, 1);
    assert.deepEqual(
      removedBaseHistory.versions.map((record) => record.versionId),
      ["base-root"],
      "deleting an unreferenced Base history entry must preserve the rest of the library",
    );
    assert.equal(isSupportedResumePhoto("data:image/jpeg;base64,Zm9v"), true);
    assert.equal(isSupportedResumePhoto("https://example.test/photo.jpg"), false);
    assert.equal(
      isSupportedResumePhoto(`data:image/jpeg;base64,${"A".repeat(90_001)}`),
      false,
      "oversized legacy photo payloads must not inflate project snapshots or resume rendering",
    );
    const sourcedMarkdown = [
      "# Candidate",
      "Frontend Engineer · candidate@example.com",
      "## Skills",
      "- Built a resumable agent runtime",
      "- Reduced long-session rendering work",
    ].join("\n");
    assert.deepEqual(extractResumeClaims(sourcedMarkdown), [
      "Built a resumable agent runtime",
      "Reduced long-session rendering work",
    ]);
    assert.deepEqual(
      extractResumeClaims(
        "# Candidate\n## Projects\n- Repo：github.com/example/codeshell\n- 作品集：https://example.com/work\n- Built a resumable workflow",
      ),
      ["Built a resumable workflow"],
      "public locators should remain visible without becoming evidence claims or interview prompts",
    );
    assert.deepEqual(
      extractResumeClaims(
        "# Candidate\n## Professional Summary\nFrontend engineer with agent runtime experience.",
      ),
      ["Frontend engineer with agent runtime experience."],
    );
    assert.deepEqual(
      extractResumeClaims("# Candidate\n## Core Skills\nReact · TypeScript\nAgent workflow design"),
      ["React · TypeScript", "Agent workflow design"],
    );
    assert.deepEqual(
      selectResumeQaClaims(
        [
          "# Candidate",
          "## Core Skills",
          "- React",
          "- TypeScript",
          "## Work Experience",
          "- Led the migration of a shared workflow used across three product teams.",
          "- Reduced rendering stalls and improved long-session reliability.",
          "- Designed a rollback boundary after comparing two persistence strategies.",
        ].join("\n"),
      ),
      [
        "Led the migration of a shared workflow used across three product teams.",
        "Reduced rendering stalls and improved long-session reliability.",
        "Designed a rollback boundary after comparing two persistence strategies.",
      ],
      `${packagePath}: private resume QA must skip bare skill keywords`,
    );
    assert.equal(
      selectResumeQaClaims(
        [
          "## 专业概述",
          "5 年前端经验，近期聚焦 AI Agent、开发者工具与跨端应用。",
          "## 工作经历",
          "- 主导权限工作台重构，负责方案设计与核心模块实现。",
          "- 建设复用组件体系，缩短三个业务线的交付周期。",
          "- 推动时间线性能优化，改善长会话的交互稳定性。",
          "- 比较多种状态同步方案并设计可恢复的跨端工作流。",
        ].join("\n"),
      ).includes("5 年前端经验，近期聚焦 AI Agent、开发者工具与跨端应用。"),
      false,
      "resume QA must prioritize concrete experience bullets over the professional summary",
    );
    const evidenceCoverage = resumeEvidenceCoverage(sourcedMarkdown, [
      {
        claim: "Built a resumable agent runtime",
        status: "verified",
        importance: "core",
        whyItMatters: "Shows ownership of a reliability-critical runtime.",
        sources: [
          {
            kind: "commit",
            label: "runtime",
            locator: "commit:abc1234",
            evidence: "Adds persisted checkpoints and resume handling.",
          },
        ],
        interviewQuestions: [
          {
            question: "How did the runtime recover an interrupted run?",
            focus: "Recovery design and ownership",
          },
        ],
      },
    ]);
    assert.equal(evidenceCoverage.total, 2);
    assert.equal(evidenceCoverage.supported, 1);
    assert.equal(evidenceCoverage.complete, 1);
    assert.equal(evidenceCoverage.core, 1);
    assert.equal(evidenceCoverage.strong, 1);
    assert.equal(evidenceCoverage.publishable, 1);
    assert.deepEqual(evidenceCoverage.missing, ["Reduced long-session rendering work"]);
    assert.equal(resumeClaimStrength(evidenceCoverage.mapped[0].evidence), "strong");
    const boundaryCoverage = resumeEvidenceCoverage(
      [
        "# Candidate",
        "Candidate@example.com",
        "## Work Experience",
        "- Improved metric 1-23 after the migration.",
        "- Improved metric 12-3 after the migration.",
      ].join("\n"),
      [
        {
          claim: "Improved metric 1-23 after the migration",
          status: "verified",
          importance: "core",
          whyItMatters: "Preserves a concrete measurement boundary.",
          sources: [
            {
              kind: "file",
              label: "metrics",
              locator: "file:metrics.md",
              evidence: "Documents metric 1-23.",
            },
          ],
          interviewQuestions: [{ question: "How was metric 1-23 measured?" }],
        },
      ],
    );
    assert.equal(boundaryCoverage.total, 2);
    assert.equal(boundaryCoverage.supported, 1);
    assert.deepEqual(boundaryCoverage.missing, ["Improved metric 12-3 after the migration."]);
    assert.deepEqual(
      resumePublicationStatus({
        markdown: sourcedMarkdown,
        claimEvidence: [evidenceCoverage.mapped[0].evidence],
      }),
      {
        ready: false,
        total: 2,
        complete: 1,
        incompleteCount: 1,
        profileGaps: [],
        documentGaps: [],
      },
    );
    assert.deepEqual(
      resumePublicationStatus({
        markdown:
          "# Candidate\nFrontend Engineer · candidate@example.com\n## Skills\n- Built a resumable agent runtime!",
        claimEvidence: [
          {
            ...evidenceCoverage.mapped[0].evidence,
            claim: "Built a resumable agent runtime",
            status: "needs_review",
          },
        ],
      }),
      {
        ready: false,
        total: 1,
        complete: 0,
        incompleteCount: 1,
        profileGaps: [],
        documentGaps: [],
      },
      "a structurally complete but unverified claim must remain a private draft",
    );
    const completeSourcedEvidence = [
      evidenceCoverage.mapped[0].evidence,
      {
        claim: "Reduced long-session rendering work",
        status: "verified",
        importance: "supporting",
        whyItMatters: "Shows measurable frontend performance work.",
        sources: [
          {
            kind: "commit",
            label: "render optimization",
            locator: "commit:def5678",
            evidence: "Adds bounded rendering for long sessions.",
          },
        ],
        interviewQuestions: [
          { question: "How did you measure the rendering improvement?", focus: "Impact" },
        ],
      },
    ];
    assert.equal(
      resumePublicationStatus({
        markdown: sourcedMarkdown,
        claimEvidence: completeSourcedEvidence,
      }).ready,
      true,
    );
    const baseVariantReviewRecord = normalizeResumeRecord({
      versionId: "resume-base-review",
      kind: "base",
      category: "AI Engineering",
      markdown: [
        "# Candidate",
        "AI Engineer · candidate@example.com",
        "## Work Experience",
        "- Built a resumable agent runtime",
        "- Reduced long-session rendering work",
        "- Owned unrelated legacy documentation",
      ].join("\n"),
      claimEvidence: [
        ...completeSourcedEvidence,
        {
          claim: "Owned unrelated legacy documentation",
          status: "verified",
          importance: "supporting",
          whyItMatters: "Preserves useful Base context.",
          sources: [
            {
              kind: "file",
              label: "Legacy docs",
              locator: "file:legacy.md",
              evidence: "Documents the maintained scope.",
            },
          ],
          interviewQuestions: [{ question: "What did you own?", focus: "Ownership" }],
        },
      ],
    });
    const reviewedVariantEvidence = [
      {
        ...completeSourcedEvidence[0],
        claim: "Built a resumable agent runtime for AI-assisted development workflows",
        whyItMatters: "Aligns the same verified runtime work with the target role.",
      },
      completeSourcedEvidence[1],
      {
        claim: "Added an interview practice feedback loop",
        status: "verified",
        importance: "supporting",
        whyItMatters: "Highlights feedback-loop product work relevant to the JD.",
        sources: [
          {
            kind: "file",
            label: "Practice flow",
            locator: "file:practice-flow.md",
            evidence: "Implements answer, review, and retry states.",
          },
        ],
        interviewQuestions: [{ question: "How does the loop work?", focus: "Product depth" }],
      },
    ];
    const variantReviewRecord = normalizeResumeRecord({
      versionId: "resume-variant-review",
      kind: "variant",
      category: "AI Engineering",
      baseResumeId: "resume-base-review",
      jobId: "job-review",
      markdown: [
        "# Candidate",
        "AI Engineer · candidate@example.com",
        "## Work Experience",
        "- Built a resumable agent runtime for AI-assisted development workflows",
        "- Reduced long-session rendering work",
        "- Added an interview practice feedback loop",
      ].join("\n"),
      claimEvidence: reviewedVariantEvidence,
    });
    variantReviewRecord.variantChanges = deriveResumeVariantChanges(
      baseVariantReviewRecord,
      variantReviewRecord,
      {
        title: "AI Product Engineer",
        description:
          "岗位职责：Build AI-assisted development tools and resumable agent workflows；Create interview practice feedback loops。任职要求：Experience with agent runtimes and failure recovery；Strong product feedback-loop design。",
      },
    );
    assert.deepEqual(
      variantReviewRecord.variantChanges.map((item) => item.type),
      ["rewrite", "addition", "removal"],
      "Base-to-job diff should distinguish rewrites from independent additions and removals",
    );
    assert.equal(pendingResumeVariantChangeCount(variantReviewRecord), 3);
    assert.equal(
      variantReviewRecord.variantChanges[0].sourceRefs[0],
      "commit:abc1234",
      "each proposed change should retain a reviewable source locator",
    );
    assert(
      variantReviewRecord.variantChanges[0].jobRequirementRefs.some((item) =>
        item.includes("resumable agent workflows"),
      ),
      "each proposed change should retain the exact JD requirement it is trying to address",
    );
    assert.equal(
      snapshotSchema.$defs.resumeVariantChange.required.includes("jobRequirementRefs"),
      true,
      "the project schema must persist JD requirement references",
    );
    assert(
      snapshotSchema.$defs.resumeRecord.required.includes("parentVersionId") &&
        snapshotSchema.$defs.resumeRecord.required.includes("revisionReason"),
      "the project schema must persist resume revision lineage",
    );
    const confirmedRewrite = decideResumeVariantChange(variantReviewRecord, {
      changeId: variantReviewRecord.variantChanges[0].id,
      decision: "kept",
      baseRecord: baseVariantReviewRecord,
      updatedAt: "2026-08-11T08:00:00Z",
    }).record;
    assert(confirmedRewrite.markdown.includes("AI-assisted development workflows"));
    assert.equal(confirmedRewrite.variantChanges[0].status, "kept");
    const revertedRewrite = decideResumeVariantChange(confirmedRewrite, {
      changeId: confirmedRewrite.variantChanges[0].id,
      decision: "reverted",
      baseRecord: baseVariantReviewRecord,
      updatedAt: "2026-08-11T08:01:00Z",
    }).record;
    assert(revertedRewrite.markdown.includes("- Built a resumable agent runtime\n"));
    assert(!revertedRewrite.markdown.includes("AI-assisted development workflows"));
    assert.equal(
      resumeEvidenceCoverage(revertedRewrite.markdown, revertedRewrite.claimEvidence).missing
        .length,
      0,
      "restoring Base wording should also retain the Base evidence mapping",
    );
    const userEditedRewrite = editResumeVariantChange(revertedRewrite, {
      changeId: revertedRewrite.variantChanges[0].id,
      after: "Built a resumable agent runtime with explicit recovery boundaries",
      updatedAt: "2026-08-11T08:01:30Z",
    }).record;
    assert(
      userEditedRewrite.markdown.includes(
        "Built a resumable agent runtime with explicit recovery boundaries",
      ),
    );
    assert.equal(userEditedRewrite.variantChanges[0].status, "kept");
    assert.equal(userEditedRewrite.variantChanges[0].userEdited, true);
    assert.equal(
      resumeEvidenceCoverage(userEditedRewrite.markdown, userEditedRewrite.claimEvidence).missing
        .length,
      0,
      "editing a sourced job wording should move its evidence mapping to the edited claim",
    );
    assert(baseVariantReviewRecord.markdown.includes("Built a resumable agent runtime"));
    const restoredRewrite = decideResumeVariantChange(revertedRewrite, {
      changeId: revertedRewrite.variantChanges[0].id,
      decision: "kept",
      baseRecord: baseVariantReviewRecord,
      updatedAt: "2026-08-11T08:02:00Z",
    }).record;
    assert(restoredRewrite.markdown.includes("AI-assisted development workflows"));
    const additionChange = restoredRewrite.variantChanges.find((item) => item.type === "addition");
    const withoutAddition = decideResumeVariantChange(restoredRewrite, {
      changeId: additionChange.id,
      decision: "reverted",
      baseRecord: baseVariantReviewRecord,
      updatedAt: "2026-08-11T08:03:00Z",
    }).record;
    assert(!withoutAddition.markdown.includes("interview practice feedback loop"));
    const withAdditionAgain = decideResumeVariantChange(withoutAddition, {
      changeId: additionChange.id,
      decision: "kept",
      baseRecord: baseVariantReviewRecord,
      updatedAt: "2026-08-11T08:04:00Z",
    }).record;
    assert(withAdditionAgain.markdown.includes("interview practice feedback loop"));
    assert(baseVariantReviewRecord.markdown.includes("Owned unrelated legacy documentation"));
    assert.equal(normalizeResumeVariantChanges([{ before: "Base fact" }]).length, 1);
    assert.deepEqual(
      resumeProfilePublicationGaps({
        name: "姓名待确认",
        role: "Frontend Engineer",
        contact: "",
      }),
      ["姓名", "联系方式"],
    );
    assert.equal(hasActionableResumeContact("Shanghai · available immediately"), false);
    assert.equal(hasActionableResumeContact("2020-2026"), false);
    assert.equal(hasActionableResumeContact("Frontend Engineer · 2020-2026"), false);
    assert.equal(hasActionableResumeContact("+65 8123 4567"), true);
    assert.equal(hasActionableResumeContact("candidate@example.com · Shanghai"), true);
    assert.deepEqual(
      resumeDocumentPublicationGaps(
        "# 你的姓名\nFrontend Engineer · 联系方式待补充\n## 工作经历\n- 请补充经历",
      ),
      ["简历姓名标题", "简历中的可用联系方式", "公开简历占位内容"],
      "placeholder copy must remain editable as a draft but must not pass the publication gate",
    );
    assert.deepEqual(resumeDocumentPublicationGaps(sourcedMarkdown), []);
    assert.deepEqual(
      resumeDocumentPublicationGaps(
        "# Candidate\nFrontend Engineer\n##Projects\n- Repo: github.com/example/project",
      ),
      ["简历中的可用联系方式"],
      "a body repository link must not satisfy the public header contact requirement",
    );
    assert(
      resumeDocumentPublicationGaps(
        "# Candidate\nFrontend Engineer · candidate@example.com\n## Summary\nPlaceholder: to be confirmed",
      ).includes("公开简历占位内容"),
    );
    assert.deepEqual(
      resumeDocumentPublicationGaps(
        "# Candidate\nFrontend Engineer · unknown@example.com\n## Work Experience\n- Implemented placeholder loading states for slow networks.",
      ),
      [],
      "legitimate technical uses of placeholder or unknown must not block publication",
    );
    assert.equal(
      resumePublicationStatus(
        { markdown: sourcedMarkdown, claimEvidence: completeSourcedEvidence },
        { name: "Candidate", role: "Frontend Engineer", contact: "" },
      ).ready,
      false,
      "a verified claim ledger must not publish without contact information",
    );
    const candidateQuestions = normalizeResumeQaQuestions([
      {
        id: "qa-impact",
        category: "impact",
        priority: "high",
        question: "What changed after launch?",
        why: "Recover a verifiable outcome.",
        related_claim: "Built a resumable agent runtime",
        source_hints: ["release notes"],
      },
      {
        id: "qa-owner",
        category: "ownership",
        priority: "high",
        question: "What did you personally own?",
        why: "Separate team output from personal contribution.",
        status: "answered",
        answer: "I designed the checkpoint model.",
        source_refs: ["user:resume-qa:qa-owner"],
      },
    ]);
    assert.equal(candidateQuestions[0].relatedClaim, "Built a resumable agent runtime");
    assert.deepEqual(candidateQuestions[0].sourceHints, ["release notes"]);
    assert.deepEqual(resumeQaCounts({ candidateQuestions }), {
      total: 2,
      open: 1,
      answered: 1,
      needsSource: 0,
      skipped: 0,
    });
    const savedPanelAnswer = updateResumeQaAnswer(candidateQuestions, {
      questionId: "qa-impact",
      status: "answered",
      answer: "Launch cut the manual recovery flow from three steps to one.",
      sourceRefs: ["user:resume-qa:qa-impact"],
      suggestedChange: "Reduced manual recovery from three steps to one.",
      answeredAt: "2026-08-10T09:00:00Z",
    });
    assert.equal(savedPanelAnswer.question.status, "answered");
    assert.equal(savedPanelAnswer.question.sourceRefs[0], "user:resume-qa:qa-impact");
    assert.equal(savedPanelAnswer.questions[1].answer, "I designed the checkpoint model.");
    assert.throws(
      () =>
        updateResumeQaAnswer(candidateQuestions, {
          questionId: "qa-impact",
          status: "answered",
          answer: "Unverified result",
          sourceRefs: [],
        }),
      /至少需要一个 Source/,
      "confirmed resume facts must retain their evidence source",
    );
    assert.equal(
      normalizeResumeQaQuestion({ question: "Which result can you verify?" }, 0).id,
      normalizeResumeQaQuestion({ question: "Which result can you verify?" }, 7).id,
      "resume QA fallback IDs must remain stable when question order changes",
    );
    const mergedCandidateQuestions = mergeResumeQaQuestions(candidateQuestions, [
      {
        id: "qa-owner",
        category: "ownership",
        priority: "high",
        question: "What did you personally own?",
        why: "Keep the revised wording but preserve the candidate response.",
      },
      {
        id: "qa-new",
        category: "decision",
        priority: "medium",
        question: "Which alternative did you reject?",
        why: "Recover the trade-off.",
      },
    ]);
    assert.equal(mergedCandidateQuestions[0].status, "answered");
    assert.equal(mergedCandidateQuestions[0].answer, "I designed the checkpoint model.");
    assert.deepEqual(mergedCandidateQuestions[0].sourceRefs, ["user:resume-qa:qa-owner"]);
    assert.equal(mergedCandidateQuestions[1].id, "qa-new");
    const preservedOmittedAnswer = mergeResumeQaQuestions(candidateQuestions, [
      {
        id: "qa-new",
        category: "decision",
        priority: "medium",
        question: "Which alternative did you reject?",
        why: "Recover the trade-off.",
      },
    ]);
    assert.equal(
      preservedOmittedAnswer.at(-1).id,
      "qa-owner",
      "resolved or deferred QA omitted by the next draft must remain attached to the target resume",
    );
    const saturatedHistory = Array.from({ length: 12 }, (_, index) => ({
      id: `qa-history-${index}`,
      question: `Historical answer ${index}?`,
      status: "answered",
      answer: `Verified answer ${index}`,
      sourceRefs: [`user:resume-qa:${index}`],
    }));
    const freshQuestions = Array.from({ length: 5 }, (_, index) => ({
      id: `qa-fresh-${index}`,
      question: `Current resume gap ${index}?`,
      status: "open",
    }));
    const refreshedQa = mergeResumeQaQuestions(saturatedHistory, freshQuestions);
    assert.deepEqual(
      refreshedQa.slice(0, 5).map((item) => item.id),
      freshQuestions.map((item) => item.id),
      "bounded historical answers must not starve every question for the current resume",
    );
    assert.equal(refreshedQa.filter((item) => item.id.startsWith("qa-history-")).length, 4);
    const pipelineBase = normalizeResumeRecord({
      ...legacyBase,
      markdown: sourcedMarkdown,
      claimEvidence: completeSourcedEvidence,
    });
    const pipelineVariant = normalizeResumeRecord({
      ...legacyVariant,
      markdown: sourcedMarkdown,
      claimEvidence: completeSourcedEvidence,
    });
    assert.deepEqual(
      resolveResumePipelineStep({
        records: [pipelineBase],
        activeResume: pipelineBase,
        candidateSourceCount: 1,
        profile: { name: "Candidate", role: "Frontend Engineer", contact: "" },
      }),
      { action: "sources", profileGaps: ["联系方式"] },
      "missing public identity fields must route back to source setup before tailoring",
    );
    assert.equal(
      resolveResumePipelineStep({
        records: [legacyBase],
        activeResume: legacyBase,
        candidateSourceCount: 1,
      }).action,
      "evidence",
      "a legacy public resume without a verified claim ledger must be remediated before tailoring",
    );
    assert.deepEqual(
      resolveResumePipelineStep({
        records: [pipelineBase],
        activeResume: pipelineBase,
        candidateSourceCount: 1,
      }),
      { action: "target" },
      `${packagePath}: a Base Resume must lead to target selection before export`,
    );
    assert.deepEqual(
      resolveResumePipelineStep({
        records: [pipelineBase],
        activeResume: pipelineBase,
        candidateSourceCount: 1,
        eligibleJobs: [{ id: "job-existing" }],
        selectedJobId: "job-existing",
      }),
      { action: "variant", targetJobId: "job-existing" },
    );
    assert.deepEqual(
      resolveResumePipelineStep({
        records: [pipelineBase],
        activeResume: pipelineBase,
        candidateSourceCount: 1,
        eligibleJobs: [{ id: "job-a" }, { id: "job-b" }],
      }),
      { action: "target" },
      `${packagePath}: multiple eligible jobs need an explicit target selection`,
    );
    assert.equal(
      resolveResumePipelineStep({
        records: [pipelineBase, pipelineVariant],
        activeResume: pipelineBase,
        candidateSourceCount: 1,
        eligibleJobs: [{ id: "job-existing" }],
        selectedJobId: "job-existing",
      }).action,
      "open-variant",
    );
    assert.equal(
      resolveResumePipelineStep({
        records: [pipelineBase, pipelineVariant],
        activeResume: pipelineVariant,
        candidateSourceCount: 1,
        eligibleJobs: [{ id: "job-existing" }],
        selectedJobId: "job-existing",
      }).action,
      "export",
    );
    assert.deepEqual(
      resolveResumePipelineStep({
        records: [baseVariantReviewRecord, variantReviewRecord],
        activeResume: variantReviewRecord,
        candidateSourceCount: 1,
        eligibleJobs: [{ id: "job-review" }],
        selectedJobId: "job-review",
      }),
      {
        action: "review-variant",
        targetJobId: "job-review",
        targetResumeId: "resume-variant-review",
        pendingChangeCount: 3,
      },
      "a generated job variant must be reviewed change by change before export",
    );
    assert.deepEqual(
      resumeExportStatus({
        updatedAt: "2026-08-09T10:00:00.000Z",
        pdfExports: [{ path: "resume.pdf", exportedAt: "2026-08-09T09:00:00.000Z" }],
      }),
      {
        count: 1,
        latestExportAt: "2026-08-09T09:00:00.000Z",
        fresh: false,
      },
      `${packagePath}: an edited resume must invalidate an older export`,
    );
    assert.equal(
      resumeExportStatus({
        updatedAt: "2026-08-09T10:00:00.000Z",
        pdfExports: [{ path: "resume.pdf", exportedAt: "2026-08-09T11:00:00.000Z" }],
      }).fresh,
      true,
    );
    const timezoneAwareExport = normalizeResumeRecord({
      kind: "base",
      category: "Frontend",
      pdfExports: [
        { path: "older.pdf", exportedAt: "2026-08-09T09:00:00+08:00", size: 1 },
        { path: "newer.pdf", exportedAt: "2026-08-09T02:30:00Z", size: 2 },
      ],
    });
    assert.equal(timezoneAwareExport.pdfExports[0].path, "newer.pdf");
    assert.equal(
      resumeExportStatus({
        updatedAt: "2026-08-09T10:00:00+08:00",
        pdfExports: timezoneAwareExport.pdfExports,
      }).fresh,
      true,
    );
    assert.equal(
      resumeExportStatus({
        updatedAt: "legacy-date-without-a-parseable-time",
        pdfExports: timezoneAwareExport.pdfExports,
      }).fresh,
      false,
    );

    const {
      PROJECT_CANDIDATE_TEMPLATE_PATHS,
      buildProjectBootstrapTask,
      resolveProjectBootstrapStatus,
    } = await import(pathToFileURL(join(root, "app", "project-bootstrap.mjs")));
    assert.equal(resolveProjectBootstrapStatus().state, "missing");
    assert.equal(
      resolveProjectBootstrapStatus({
        hasCodeshellFile: true,
        hasSnapshot: true,
      }).state,
      "partial",
    );
    assert.equal(
      resolveProjectBootstrapStatus({
        hasCodeshellFile: true,
        hasSnapshot: true,
        repositories: [{ id: "repo-1" }],
        experiences: [{ id: "exp-1" }],
      }).state,
      "ready",
    );
    assert.equal(resolveProjectBootstrapStatus({ snapshotUnreadable: true }).state, "blocked");
    const bootstrapTask = buildProjectBootstrapTask({
      workspace: "/current/job-project",
      projectName: "My Job Project",
      hasCodeshellFile: true,
      hasSnapshot: false,
      resumeEvidenceProtocol: "Every claim needs real evidence.",
    });
    assert.equal(bootstrapTask.metadata.target.kind, "project-bootstrap");
    assert.equal(bootstrapTask.metadata.target.payload.workspace, "/current/job-project");
    assert.match(bootstrapTask.prompt, /只处理当前项目/);
    assert.match(bootstrapTask.prompt, /不打开、切换或修改其他 Repo/);
    assert.match(bootstrapTask.prompt, /不要把占位文字当成候选人事实/);
    assert.match(bootstrapTask.prompt, /至少有足够证据支持 3 条真实简历要点/);
    assert.match(bootstrapTask.prompt, /Every claim needs real evidence/);
    for (const candidatePath of PROJECT_CANDIDATE_TEMPLATE_PATHS) {
      assert.match(bootstrapTask.prompt, new RegExp(candidatePath.replaceAll(".", "\\.")));
    }

    const { appendTraceEvent, attachTraceArtifact, finalizeTrace, transitionTraceForBusy } =
      await import(pathToFileURL(join(root, "app", "trace-model.mjs")));
    const trace = {
      id: "trace-1",
      status: "submitted",
      events: [],
      artifacts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    assert.equal(
      appendTraceEvent(trace, {
        id: "event-submitted",
        kind: "submitted",
        label: "Panel submitted",
        at: "2026-01-01T00:00:00.000Z",
      }),
      true,
    );
    assert.equal(
      appendTraceEvent(trace, {
        id: "event-duplicate",
        kind: "submitted",
        label: "Panel submitted",
        at: "2026-01-01T00:00:00.100Z",
      }),
      false,
    );
    assert.equal(
      transitionTraceForBusy(trace, false, true, {
        id: "event-running",
        at: "2026-01-01T00:00:01.000Z",
      }),
      true,
    );
    assert.equal(trace.status, "running");
    assert.equal(
      appendTraceEvent(trace, {
        id: "event-source",
        kind: "source",
        label: "Read commit evidence",
        detail: "commit:abc1234",
        at: "2026-01-01T00:00:01.500Z",
      }),
      true,
    );
    assert.equal(
      attachTraceArtifact(
        trace,
        { kind: "resume", id: "resume-1", label: "Base resume" },
        { id: "event-artifact", at: "2026-01-01T00:00:02.000Z" },
      ),
      true,
    );
    assert.equal(trace.artifacts.length, 1);
    assert.equal(
      transitionTraceForBusy(trace, true, false, {
        id: "event-completed",
        at: "2026-01-01T00:00:03.000Z",
      }),
      true,
    );
    assert.equal(trace.status, "completed");
    assert.match(trace.events.at(-1).detail, /^已写回 1 个结构化产物/);
    assert.equal(trace.startedAt, "2026-01-01T00:00:01.000Z");
    assert.equal(trace.completedAt, "2026-01-01T00:00:03.000Z");
    assert.equal(trace.outcome.status, "completed");
    assert.deepEqual(trace.outcome.outputRefs, ["resume:resume-1"]);
    assert.equal(
      finalizeTrace(trace, {
        status: "partial",
        summary: "Saved a base resume; two metrics still need confirmation.",
        outputRefs: ["resume:resume-1", "file:career-data/projects.md"],
        error: "Two outcome metrics are unverified.",
        at: "2026-01-01T00:00:03.500Z",
      }),
      true,
    );
    assert.equal(trace.status, "partial");
    assert.equal(trace.outcome.outputRefs.length, 2);
    assert.equal(trace.events.at(-1).kind, "partial");
    assert.equal(
      appendTraceEvent(trace, {
        id: "event-feedback",
        kind: "feedback",
        label: "User marked useful",
        at: "2026-01-01T00:00:04.000Z",
      }),
      true,
    );
    assert.equal(trace.status, "partial");

    const { PANEL_LOCAL_STORAGE_TARGET_BYTES, compactPanelLocalState, encodedJsonBytes } =
      await import(pathToFileURL(join(root, "app", "storage-model.mjs")));
    const oversizedLocalState = {
      selectedJobId: "job-existing",
      activeView: "interviews",
      profile: { photoDataUrl: `data:image/jpeg;base64,${"x".repeat(300_000)}` },
      jobs: [{ description: "JD".repeat(100_000) }],
      interviewDraft: {
        questionId: "bank-draft",
        practiceSessionId: "mock-draft",
        answer: "草".repeat(6000),
        inputMode: "typed",
        updatedAt: "2026-08-11T10:01:00.000Z",
      },
      resumeDraft: {
        resumeVersionId: "resume-draft",
        parentVersionId: "resume-parent",
        markdown: "简".repeat(80_000),
        updatedAt: "2026-08-11T10:02:00.000Z",
      },
      sessionActivity: Array.from({ length: 24 }, (_, index) => ({
        id: `trace-${index}`,
        externalTraceId: index === 0 ? "session-detached-review" : "",
        instruction: `instruction-${index}`,
        requestPrompt: "prompt".repeat(3_000),
        workspace: "/project",
        status: "completed",
        outcome: {
          status: "completed",
          summary: "Saved a source-backed base resume.",
          outputRefs: ["resume:resume-1"],
          error: "",
          completedAt: "2026-01-01T00:00:03.000Z",
        },
        startedAt: "2026-01-01T00:00:01.000Z",
        completedAt: "2026-01-01T00:00:03.000Z",
        events: Array.from({ length: 40 }, (_, eventIndex) => ({
          id: `event-${index}-${eventIndex}`,
          kind: "source",
          label: "Source resolved",
          detail: "detail".repeat(300),
          at: "2026-01-01T00:00:00.000Z",
        })),
      })),
    };
    const compactedLocalState = compactPanelLocalState(oversizedLocalState);
    assert(encodedJsonBytes(compactedLocalState) <= PANEL_LOCAL_STORAGE_TARGET_BYTES);
    assert.equal(compactedLocalState.selectedJobId, "job-existing");
    assert.equal(compactedLocalState.activeView, "interviews");
    assert.equal(compactedLocalState.profile, undefined);
    assert.equal(compactedLocalState.jobs, undefined);
    assert.equal(compactedLocalState.interviewDraft.answer.length, 6000);
    assert.equal(compactedLocalState.interviewDraft.questionId, "bank-draft");
    assert.equal(compactedLocalState.resumeDraft.resumeVersionId, "resume-draft");
    assert.equal(compactedLocalState.resumeDraft.parentVersionId, "resume-parent");
    assert.equal(compactedLocalState.resumeDraft.markdown.length, 50_000);
    assert(compactedLocalState.sessionActivity.length > 0);
    assert.equal(compactedLocalState.sessionActivity[0].outcome.status, "completed");
    assert.equal(compactedLocalState.sessionActivity[0].outcome.outputRefs[0], "resume:resume-1");
    assert.equal(compactedLocalState.sessionActivity[0].externalTraceId, "session-detached-review");
    assert.equal(compactedLocalState.sessionActivity[0].completedAt, "2026-01-01T00:00:03.000Z");
  }
  if (manifest.id === "video-download") {
    const appScript = await readFile(join(root, "app", "app.js"), "utf8");
    const setupSkill = await readFile(
      join(root, "agent", "skills", "video-download-setup", "SKILL.md"),
      "utf8",
    );
    const setupReference = await readFile(
      join(root, "agent", "skills", "video-download-setup", "references", "platform-install.md"),
      "utf8",
    );
    const githubReleaseReference = await readFile(
      join(root, "agent", "skills", "video-download-setup", "references", "github-release.md"),
      "utf8",
    );
    const toolNames = new Set(manifest.agent.tools.map((tool) => tool.name));
    const registeredToolNames = new Set(
      [...appScript.matchAll(/registerTool\("([a-z][a-z0-9_]*)"/g)].map((match) => match[1]),
    );
    const queriedIds = [...appScript.matchAll(/document\.querySelector\("#([a-z0-9-]+)"\)/g)].map(
      (match) => match[1],
    );
    const versionHelpers = await import(
      `${pathToFileURL(join(root, "app", "version.js")).href}?validate=${Date.now()}`
    );
    assert.equal(manifest.version, "0.19.0", `${packagePath}: download engine version mismatch`);
    assert.equal(
      versionHelpers.parseYtDlpVersionOutput("2026.7.4\n"),
      "2026.07.04",
      `${packagePath}: installed version parser mismatch`,
    );
    assert.equal(
      versionHelpers.parseGitHubLatestRelease('{"tag_name":"2026.08.19"}'),
      "2026.08.19",
      `${packagePath}: GitHub release parser mismatch`,
    );
    assert.deepEqual(
      versionHelpers.parseGitHubRelease(
        '{"tag_name":"2026.08.19","assets":[{"name":"yt-dlp.exe","digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}',
      ),
      {
        tag: "2026.08.19",
        version: "2026.08.19",
        assets: {
          "yt-dlp.exe": {
            name: "yt-dlp.exe",
            sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        },
      },
      `${packagePath}: GitHub asset digest parser mismatch`,
    );
    assert.equal(
      versionHelpers.compareYtDlpVersions("2026.07.04", "2026.08.19"),
      -1,
      `${packagePath}: version comparison mismatch`,
    );
    assert.equal(
      versionHelpers.shouldOfferSetup({
        dependenciesChecked: true,
        hasYtDlp: true,
        hasFfmpeg: true,
        installedYtDlpVersion: "2026.07.04",
        latestYtDlpVersion: "2026.08.19",
      }),
      true,
      `${packagePath}: an outdated yt-dlp must keep one-click setup visible`,
    );
    assert.equal(
      versionHelpers.shouldOfferSetup({
        dependenciesChecked: true,
        hasYtDlp: true,
        hasFfmpeg: true,
        installedYtDlpVersion: "2026.08.19",
        latestYtDlpVersion: "2026.08.19",
      }),
      false,
      `${packagePath}: current dependencies must hide one-click setup`,
    );
    assert.match(
      appScript,
      /https:\/\/api\.github\.com\/repos\/yt-dlp\/yt-dlp\/releases\/latest/,
      `${packagePath}: latest version lookup must use the fixed official GitHub API`,
    );
    assert.match(
      appScript,
      /api\.github\.com\/repos\/yt-dlp\/FFmpeg-Builds\/releases\/latest/,
      `${packagePath}: missing ffmpeg must use the verified GitHub build release`,
    );
    assert.match(
      appScript,
      /PowerShell 备用通道/,
      `${packagePath}: Windows setup needs a curl-independent HTTPS fallback`,
    );
    assert(
      manifest.permissions.includes("process"),
      `${packagePath}: process permission is required`,
    );
    assert(
      manifest.permissions.includes("credentials.cookies"),
      `${packagePath}: cookie account permission is required`,
    );
    assert(
      manifest.permissions.includes("agent.task"),
      `${packagePath}: isolated Task permission is required`,
    );
    assert(
      !manifest.permissions.includes("context.session") &&
        !manifest.permissions.includes("agent.submitPrompt"),
      `${packagePath}: setup and analysis must not depend on the current Session`,
    );
    assert.deepEqual(
      [...registeredToolNames].sort(),
      [...toolNames].sort(),
      `${packagePath}: manifest tools and registered handlers must match`,
    );
    for (const id of queriedIds) {
      assert.match(html, new RegExp(`id="${id}"`), `${packagePath}: missing #${id}`);
    }
    const applyTool = manifest.agent.tools.find(
      (tool) => tool.name === "apply_video_download_config",
    );
    assert(
      applyTool.inputSchema.properties.format.enum.includes("720"),
      `${packagePath}: 720p preset is required`,
    );
    assert(
      applyTool.inputSchema.properties.format.enum.includes("2160"),
      `${packagePath}: 4K preset is required`,
    );
    for (const expected of [
      "--continue",
      "--fragment-retries",
      "exp=1:30",
      "--playlist-items",
      "--convert-subs",
      "friendlyYtDlpError",
      "sanitizeMediaUrl",
      "renderDownloadList",
      "requestAiErrorAnalysis",
      "requestDirectSetup",
      "requestAiSetup",
      "refreshRuntimeDependencies",
      'panel.call("agent.task.start"',
      'panel.call("agent.task.list"',
      'panel.on("agent.task.changed"',
      'panel.call("credentials.cookies.authorizeProcess"',
      "fileArgumentHandles",
    ]) {
      assert(appScript.includes(expected), `${packagePath}: missing ${expected}`);
    }
    assert.match(html, /id="download-list"/, `${packagePath}: download list is required`);
    assert.match(html, /id="cookie-select"/, `${packagePath}: cookie picker is required`);
    assert.match(html, /id="quality-select"/, `${packagePath}: quality picker is required`);
    assert.match(html, /id="subtitle-mode"/, `${packagePath}: subtitle source picker is required`);
    assert.match(
      html,
      /id="subtitle-language-preset"/,
      `${packagePath}: subtitle language picker is required`,
    );
    assert.match(
      html,
      /id="subtitle-embed"/,
      `${packagePath}: subtitle embedding must be optional`,
    );
    assert.match(
      html,
      /id="setup-update-button"/,
      `${packagePath}: deterministic setup action is required`,
    );
    assert.match(
      html,
      /id="setup-ai-button"/,
      `${packagePath}: optional AI repair action is required`,
    );
    assert.match(
      html,
      /data-task-provider/,
      `${packagePath}: AI Task provider selector is required`,
    );
    assert.match(html, /data-task-model/, `${packagePath}: AI Task model selector is required`);
    assert.match(
      appScript,
      /panel\.call\("agent\.task\.models"\)/,
      `${packagePath}: AI Task models must come from the Host`,
    );
    assert.match(
      appScript,
      /panel\.call\("process\.info"\)/,
      `${packagePath}: deterministic setup needs Host platform metadata`,
    );
    assert.match(
      appScript,
      /name: "user-bin"/,
      `${packagePath}: deterministic setup must use the Host-managed bin directory`,
    );
    assert.match(
      html,
      /id="analyze-error-button"/,
      `${packagePath}: failure analysis action is required`,
    );
    assert.match(
      html,
      /id="error-analysis-result"/,
      `${packagePath}: Task analysis result must render in the panel`,
    );
    assert(
      !html.includes("让 AI 帮我选配置"),
      `${packagePath}: normal flow must not include AI configuration UI`,
    );
    assert(
      !appScript.includes("requestAiConfiguration"),
      `${packagePath}: configuration prompt flow must be removed`,
    );
    assert.deepEqual(
      manifest.agent.skills,
      ["agent/skills/video-download-setup/SKILL.md"],
      `${packagePath}: setup Skill must ship with the Panel App`,
    );
    assert.match(
      setupSkill,
      /refresh_video_download_dependencies/,
      `${packagePath}: setup Skill must verify through the panel`,
    );
    assert.match(
      setupSkill,
      /Always handle `yt-dlp` first/,
      `${packagePath}: setup Skill must update or install yt-dlp first`,
    );
    assert.match(
      appScript,
      /即使面板只报告缺少 ffmpeg，也不能跳过前面的 yt-dlp 更新/,
      `${packagePath}: one-click prompt must preserve dependency order`,
    );
    assert.match(
      appScript,
      /api\.github\.com\/repos\/yt-dlp\/yt-dlp\/releases\/latest/,
      `${packagePath}: one-click prompt must resolve the official GitHub release`,
    );
    assert.match(
      appScript,
      /SHA2-256SUMS/,
      `${packagePath}: one-click prompt must require binary checksum verification`,
    );
    assert.match(
      setupSkill,
      /Never start a video inspection or download/,
      `${packagePath}: setup Skill must not start media work`,
    );
    assert.match(
      setupReference,
      /brew install yt-dlp/,
      `${packagePath}: setup Skill needs a macOS route`,
    );
    assert.match(
      setupReference,
      /execution order is non-negotiable/,
      `${packagePath}: platform reference must preserve setup order`,
    );
    assert.match(
      setupSkill,
      /api\.github\.com\/repos\/yt-dlp\/yt-dlp\/releases\/latest/,
      `${packagePath}: setup Skill must use GitHub latest as its version authority`,
    );
    for (const expected of [
      "yt-dlp_macos",
      "yt-dlp_linux_aarch64",
      "yt-dlp_musllinux_aarch64",
      "yt-dlp_arm64.exe",
      "SHA2-256SUMS",
    ]) {
      assert(
        githubReleaseReference.includes(expected),
        `${packagePath}: GitHub release reference is missing ${expected}`,
      );
    }
    assert.match(
      githubReleaseReference,
      /still needs Python/,
      `${packagePath}: generic yt-dlp artifact must not be treated as standalone`,
    );
  }
  return { id: manifest.id, files: files.length };
}

const results = [];
assert.equal(isHostSafeSchemaPattern("^[a-z][a-z0-9-]{0,63}$"), true);
assert.equal(isHostSafeSchemaPattern("^(a+)+$"), false);
assert.equal(isHostSafeSchemaPattern("^a+a+$"), false);
assert.equal(isHostSafeSchemaPattern("^(?:md|mdx|txt)$"), false);
for (const packagePath of packages) results.push(await validatePackage(packagePath));

const geometry = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/geometry.mjs"))
);
assert.deepEqual(
  geometry.selectionBounds([
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 20, y: 10, width: 5, height: 5 },
  ]),
  { x: 0, y: 0, width: 25, height: 15 },
);

const designCodec = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/document.mjs"))
);
const designBundle = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/document-bundle.mjs"))
);
const designIndex = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/document-index.mjs"))
);
const designPageRuntime = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/page-runtime.mjs"))
);
const designOperationLog = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/operation-log.mjs"))
);
const designResources = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/resource-store.mjs"))
);
const designRecovery = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/recovery-store.mjs"))
);
const designAudit = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/audit.mjs"))
);
const designRepository = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/repository.mjs"))
);
const designLayout = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/layout.mjs"))
);
const designChecker = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/tools/check-design.mjs"))
);
const designFrontend = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/frontend-export.mjs"))
);
const designComparison = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/design-compare.mjs"))
);
const productBrief = await import(
  pathToFileURL(join(repositoryRoot, "apps/design-studio/app/product-brief.mjs"))
);
const baseNode = (id, type, name) => ({
  id,
  type,
  name,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  fill: type === "group" ? "transparent" : "#ffffff",
  stroke: "transparent",
  strokeWidth: 0,
  opacity: 1,
  rotation: 0,
  cornerRadius: 0,
  visible: true,
  locked: false,
});
const nestedDesign = {
  format: "codeshell.design",
  version: 3,
  name: "Nested smoke",
  canvas: { width: 1000, height: 800, background: "#eeeeee" },
  tokens: { colors: [] },
  activePageId: "page-1",
  pages: [
    {
      id: "page-1",
      name: "Page 1",
      children: [
        {
          ...baseNode("frame", "frame", "Frame"),
          layout: "grid",
          layoutWrap: "none",
          gap: 0,
          rowGap: 12,
          columnGap: 16,
          padding: 0,
          alignItems: "start",
          justifyContent: "start",
          alignContent: "stretch",
          gridColumns: 2,
          children: [
            {
              ...baseNode("group", "group", "Group"),
              fill: "transparent",
              layoutSizingHorizontal: "fill",
              layoutSizingVertical: "hug",
              gridColumnSpan: 2,
              layout: "none",
              gap: 0,
              padding: 0,
              alignItems: "start",
              justifyContent: "start",
              children: [{ ...baseNode("rect", "rectangle", "Rectangle") }],
            },
            {
              ...baseNode("adaptive-copy", "text", "Adaptive copy"),
              text: "Compact adaptive copy…",
              fontSize: 16,
              fontWeight: 400,
              lineHeight: 1.2,
              textAlign: "left",
              textSource: "Compact adaptive copy that can be shortened",
              textOverflow: "ellipsis",
              textFlowWidth: 100,
              layoutBaselineOffset: 2.5,
            },
            {
              ...baseNode("absolute-badge", "rectangle", "Absolute badge"),
              x: 70,
              y: 10,
              width: 20,
              height: 20,
              layoutPositioning: "absolute",
              constraintHorizontal: "end",
              constraintVertical: "start",
              constraintBaseWidth: 100,
              constraintBaseHeight: 100,
              constraintLeft: 70,
              constraintRight: 10,
              constraintTop: 10,
              constraintBottom: 70,
            },
          ],
        },
      ],
    },
  ],
};
const designState = designCodec.normalizeDesignDocument(nestedDesign);
assert.equal(designCodec.MAX_DESIGN_NODES_PER_PAGE, 10_000);
assert.equal(designCodec.MAX_DESIGN_PAGES, 1_000);
assert.equal(designState.nodes.length, 5);
assert.equal(designState.nodes[2].parentId, "group");
assert.equal(designState.nodes[0].layout, "grid");
assert.equal(designState.nodes[0].columnGap, 16);
assert.equal(designState.nodes[1].layoutSizingVertical, "hug");
const designRoundTrip = JSON.parse(designCodec.serializeDesignDocument(designState));
assert.equal(designRoundTrip.pages[0].children[0].children[0].children[0].id, "rect");
assert.equal(designRoundTrip.pages[0].children[0].gridColumns, 2);
assert.equal(designRoundTrip.pages[0].children[0].children[0].gridColumnSpan, 2);
assert.equal(designRoundTrip.pages[0].children[0].children[1].textOverflow, "ellipsis");
assert.equal(designRoundTrip.pages[0].children[0].children[2].constraintBaseWidth, 100);
const indexedDesignInput = structuredClone(nestedDesign);
indexedDesignInput.pages.push({
  id: "page-2",
  name: "Page 2",
  children: [{ ...baseNode("page-2-rect", "rectangle", "Page 2 rectangle") }],
});
const indexedDesign = designCodec.normalizeDesignDocument(indexedDesignInput);
const hashDesignSource = async (source) => createHash("sha256").update(source).digest("hex");
const indexedPlan = await designIndex.createDesignIndexPersistencePlan({
  document: indexedDesign,
  sha256: hashDesignSource,
});
assert.equal(indexedPlan.mode, "indexed");
assert.equal(indexedPlan.manifest.pages.length, 2);
assert.equal(indexedPlan.changedPageCount, 2);
assert.equal(
  indexedPlan.bytes,
  new TextEncoder().encode(designCodec.serializeDesignDocument(indexedDesign)).length,
);
assert(indexedPlan.parts.length >= 2);
const indexedResolved = await designIndex.resolveDesignIndexDocument({
  primarySource: indexedPlan.primarySource,
  readText: async (path) => indexedPlan.parts.find((part) => part.path === path)?.content,
  sha256: hashDesignSource,
});
assert.equal(indexedResolved.document.pages.length, 2);
assert.equal(indexedResolved.document.pages[1].children[0].id, "page-2-rect");
const unchangedIndexedPlan = await designIndex.createDesignIndexPersistencePlan({
  document: indexedDesign,
  sha256: hashDesignSource,
  previousManifest: indexedPlan.manifest,
});
assert.equal(unchangedIndexedPlan.changedPageCount, 0);
assert.equal(unchangedIndexedPlan.parts.length, 0);
const changedIndexedDesign = structuredClone(indexedDesign);
changedIndexedDesign.pages[1].nodes[0].name = "Changed on page 2";
const incrementalIndexedPlan = await designIndex.createDesignIndexPersistencePlan({
  document: changedIndexedDesign,
  sha256: hashDesignSource,
  previousManifest: indexedPlan.manifest,
});
assert.equal(incrementalIndexedPlan.changedPageCount, 1);
assert(incrementalIndexedPlan.parts.every((part) => part.pageId === "page-2"));
const loadedPageRecords = new Map([
  ["page-1", designCodec.repositoryDesignPage(indexedDesign, "page-1")],
]);
const lazySavePlan = await designIndex.createIncrementalDesignIndexPersistencePlan({
  document: indexedDesign,
  pageRecords: loadedPageRecords,
  sha256: hashDesignSource,
  previousManifest: indexedPlan.manifest,
});
assert.equal(lazySavePlan.changedPageCount, 0);
assert.equal(lazySavePlan.parts.length, 0);
assert.equal(lazySavePlan.manifest.pages[1].sha256, indexedPlan.manifest.pages[1].sha256);
const componentContainer = (id, name, children = []) => ({
  ...baseNode(id, "component", name),
  layout: "none",
  gap: 0,
  padding: 0,
  alignItems: "start",
  justifyContent: "start",
  children,
});
const lazyIndexedDesign = designCodec.normalizeDesignDocument({
  ...nestedDesign,
  name: "Lazy page smoke",
  pages: [
    {
      id: "screen",
      name: "Screen",
      children: [
        {
          ...baseNode("button-instance", "instance", "Button instance"),
          fill: "transparent",
          componentId: "button-component",
        },
      ],
    },
    {
      id: "components",
      name: "Components",
      children: [
        componentContainer("button-component", "Button", [
          {
            ...baseNode("icon-instance", "instance", "Icon instance"),
            fill: "transparent",
            componentId: "icon-component",
          },
        ]),
      ],
    },
    {
      id: "icons",
      name: "Icons",
      children: [componentContainer("icon-component", "Icon")],
    },
    {
      id: "archive",
      name: "Archive",
      children: [{ ...baseNode("archive-rect", "rectangle", "Archive") }],
    },
  ],
  activePageId: "screen",
});
const lazyIndexedPlan = await designIndex.createDesignIndexPersistencePlan({
  document: lazyIndexedDesign,
  sha256: hashDesignSource,
});
const lazyReadPaths = [];
const lazyCache = new designPageRuntime.IndexedPageCache({
  manifest: lazyIndexedPlan.manifest,
  readText: async (path) => {
    lazyReadPaths.push(path);
    return lazyIndexedPlan.parts.find((part) => part.path === path)?.content;
  },
  sha256: hashDesignSource,
  maximumLoadedPages: 3,
});
const activeClosure = await lazyCache.ensure(["screen"]);
assert.deepEqual([...activeClosure.keys()].sort(), ["components", "icons", "screen"]);
assert.equal(lazyCache.has("archive"), false);
assert.equal(lazyReadPaths.length, 3);
lazyCache.markDirty("screen");
await lazyCache.ensure(["archive"]);
assert.equal(lazyCache.has("archive"), true);
assert.equal(lazyCache.has("screen"), true);
assert.equal(lazyCache.has("components") && lazyCache.has("icons"), true);
assert.equal(lazyCache.loadedPageIds().length, 4);
lazyCache.markAllClean();
lazyCache.evict();
assert.equal(lazyCache.has("components") && lazyCache.has("icons"), false);
assert.equal(lazyCache.loadedPageIds().length, 3);
assert.equal(lazyReadPaths.length, 4);
const operationBefore = designOperationLog.captureDesignOperationState(indexedDesign);
const operationEdited = structuredClone(indexedDesign);
operationEdited.name = "Operation log edit";
operationEdited.nodes[0].name = "Edited frame";
operationEdited.nodes.push({
  ...baseNode("operation-node", "rectangle", "Operation node"),
});
operationEdited.pages[0].nodes = operationEdited.nodes;
const operationAfter = designOperationLog.captureDesignOperationState(operationEdited);
const operationRecord = designOperationLog.createDesignOperationRecord(
  operationBefore,
  operationAfter,
);
assert.equal(designOperationLog.isEmptyDesignOperationRecord(operationRecord), false);
const operationReplay = structuredClone(indexedDesign);
designOperationLog.applyDesignOperationRecord(operationReplay, operationRecord, "forward");
assert.deepEqual(designOperationLog.captureDesignOperationState(operationReplay), operationAfter);
designOperationLog.applyDesignOperationRecord(operationReplay, operationRecord, "reverse");
assert.deepEqual(designOperationLog.captureDesignOperationState(operationReplay), operationBefore);
const pixelBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const hashDesignBytes = async (bytes) => createHash("sha256").update(bytes).digest("hex");
const pixelResource = await designResources.createDesignResourcePersistencePlan({
  id: "pixel-image",
  kind: "image",
  mime: "image/png",
  base64: pixelBase64,
  sha256Bytes: hashDesignBytes,
});
const duplicatePixelResource = await designResources.createDesignResourcePersistencePlan({
  id: "pixel-image-copy",
  kind: "image",
  mime: "image/png",
  base64: pixelBase64,
  sha256Bytes: hashDesignBytes,
});
assert.equal(pixelResource.descriptor.sha256, duplicatePixelResource.descriptor.sha256);
assert.deepEqual(
  pixelResource.parts.map((part) => part.path),
  duplicatePixelResource.parts.map((part) => part.path),
);
const resolvedPixel = await designResources.resolveDesignResource({
  descriptor: pixelResource.descriptor,
  readText: async (path) => pixelResource.parts.find((part) => part.path === path)?.content,
  sha256Bytes: hashDesignBytes,
});
assert.equal(resolvedPixel.base64, pixelBase64);
assert(resolvedPixel.dataUrl.startsWith("data:image/png;base64,"));
const resourceCache = new designResources.DesignResourceCache({
  resources: [pixelResource.descriptor, duplicatePixelResource.descriptor],
  readText: async (path) => pixelResource.parts.find((part) => part.path === path)?.content,
  sha256Bytes: hashDesignBytes,
});
await resourceCache.load("pixel-image");
await resourceCache.load("pixel-image-copy");
resourceCache.retain(["pixel-image-copy"]);
assert.deepEqual(resourceCache.loadedResourceIds(), ["pixel-image-copy"]);
await assert.rejects(
  () =>
    designResources.resolveDesignResource({
      descriptor: pixelResource.descriptor,
      readText: async () => `${pixelBase64.slice(0, -4)}AAAA`,
      sha256Bytes: hashDesignBytes,
    }),
  /摘要校验失败|字节数无效/u,
);
const imageDesign = designCodec.normalizeDesignDocument({
  ...nestedDesign,
  resources: [pixelResource.descriptor],
  pages: [
    {
      id: "page-1",
      name: "Page 1",
      children: [
        {
          ...baseNode("pixel-node", "image", "Pixel"),
          fill: "transparent",
          imageRef: "pixel-image",
          objectFit: "cover",
        },
      ],
    },
  ],
});
assert.equal(imageDesign.nodes[0].imageRef, "pixel-image");
const imageSvg = designCodec.exportDesignSvg(imageDesign, {
  resourceDataUrls: new Map([["pixel-image", resolvedPixel.dataUrl]]),
});
assert(imageSvg.includes(`<image data-node-id="pixel-node"`));
assert(imageSvg.includes(resolvedPixel.dataUrl));
const fontDescriptor = {
  id: "test-font",
  kind: "font",
  mime: "font/ttf",
  bytes: 1,
  sha256: "0".repeat(64),
  partCount: 1,
  family: 'Test "Font"',
  weight: 400,
  style: "normal",
};
const fontDesign = designCodec.normalizeDesignDocument({
  ...nestedDesign,
  resources: [fontDescriptor],
  pages: [
    {
      id: "page-1",
      name: "Page 1",
      children: [
        {
          ...baseNode("font-node", "text", "Font text"),
          text: "Font text",
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 1.2,
          textAlign: "left",
          fontRef: "test-font",
        },
      ],
    },
  ],
});
const fontSvg = designCodec.exportDesignSvg(fontDesign, {
  resourceDataUrls: new Map([["test-font", "data:font/ttf;base64,AA=="]]),
});
assert(fontSvg.includes("@font-face"));
assert(fontSvg.includes("data:font/ttf;base64,AA=="));
assert(fontSvg.includes("Test &quot;Font&quot;"));
const largeRecoverySnapshot = {
  format: "codeshell.design.recovery",
  version: 1,
  workspaceRoot: "/repo",
  path: "designs/recovery.codesign.json",
  record: {
    version: 1,
    operations: [
      {
        type: "set-document",
        field: "name",
        before: "Before",
        after: "R".repeat(220 * 1024),
      },
    ],
  },
  baseDocument: null,
  baseModifiedAt: 1,
  baseRevision: "revision-1",
};
const recoveryPlan = await designRecovery.createRecoveryPersistencePlan({
  snapshot: largeRecoverySnapshot,
  sha256: hashDesignSource,
});
assert.equal(recoveryPlan.mode, "external");
assert(recoveryPlan.parts.length >= 1);
assert(new TextEncoder().encode(JSON.stringify(recoveryPlan.value)).length < 256 * 1024);
const resolvedRecovery = await designRecovery.resolveRecoveryPersistence({
  value: recoveryPlan.value,
  readText: async (path) => recoveryPlan.parts.find((part) => part.path === path)?.content,
  sha256: hashDesignSource,
});
assert.equal(resolvedRecovery.record.operations[0].after.length, 220 * 1024);
const indexedCheckerWorkspace = await mkdtemp(join(tmpdir(), "codeshell-design-index-"));
try {
  const primaryPath = join(indexedCheckerWorkspace, "designs", "indexed.codesign.json");
  await mkdir(dirname(primaryPath), { recursive: true });
  await writeFile(primaryPath, indexedPlan.primarySource);
  for (const part of indexedPlan.parts) {
    const partPath = join(indexedCheckerWorkspace, ...part.path.split("/"));
    await mkdir(dirname(partPath), { recursive: true });
    await writeFile(partPath, part.content);
  }
  const checkerResolved = await designChecker.readDesignSourcePath(primaryPath, {
    workspaceRoot: indexedCheckerWorkspace,
  });
  assert.equal(checkerResolved.mode, "indexed");
  assert.equal(checkerResolved.document.pages.length, 2);
  assert.equal(checkerResolved.primaryCanonical, true);
  const corruptedPartPath = join(indexedCheckerWorkspace, ...indexedPlan.parts[0].path.split("/"));
  await writeFile(corruptedPartPath, `${indexedPlan.parts[0].content}corrupt`);
  await assert.rejects(
    () =>
      designChecker.readDesignSourcePath(primaryPath, {
        workspaceRoot: indexedCheckerWorkspace,
      }),
    /重组后的字节数无效|摘要校验失败/u,
  );
} finally {
  await rm(indexedCheckerWorkspace, { recursive: true, force: true });
}
const largeDesignSource = `${"界面🙂".repeat(180_000)}\n`;
const largeDesignSha256 = createHash("sha256").update(largeDesignSource).digest("hex");
const largeDesignPlan = designBundle.createDesignPersistencePlan({
  source: largeDesignSource,
  name: "Large design",
  sha256: largeDesignSha256,
});
assert.equal(largeDesignPlan.mode, "bundle");
assert(largeDesignPlan.parts.length >= 2);
assert(
  largeDesignPlan.parts.every(
    (part) =>
      part.bytes <= designBundle.MAX_DESIGN_BUNDLE_PART_BYTES &&
      new TextEncoder().encode(part.content).length === part.bytes,
  ),
);
assert.equal(largeDesignPlan.parts.map((part) => part.content).join(""), largeDesignSource);
const resolvedLargeDesign = await designBundle.resolveDesignPersistenceSource({
  primarySource: largeDesignPlan.primarySource,
  readText: async (path) => largeDesignPlan.parts.find((part) => part.path === path)?.content,
  sha256: async () => largeDesignSha256,
});
assert.equal(resolvedLargeDesign.mode, "bundle");
assert.equal(resolvedLargeDesign.source, largeDesignSource);
const checkerWorkspace = await mkdtemp(join(tmpdir(), "codeshell-design-bundle-"));
try {
  const primaryPath = join(checkerWorkspace, "designs", "large.codesign.json");
  await mkdir(dirname(primaryPath), { recursive: true });
  await writeFile(primaryPath, largeDesignPlan.primarySource);
  for (const part of largeDesignPlan.parts) {
    const partPath = join(checkerWorkspace, ...part.path.split("/"));
    await mkdir(dirname(partPath), { recursive: true });
    await writeFile(partPath, part.content);
  }
  const checkerResolved = await designChecker.readDesignSourcePath(primaryPath, {
    workspaceRoot: checkerWorkspace,
  });
  assert.equal(checkerResolved.source, largeDesignSource);
  assert.equal(checkerResolved.primaryCanonical, true);
} finally {
  await rm(checkerWorkspace, { recursive: true, force: true });
}
const unsafeLargeManifest = structuredClone(largeDesignPlan.manifest);
unsafeLargeManifest.parts[0].path = "designs/other.txt";
assert.throws(() => designBundle.normalizeDesignBundleManifest(unsafeLargeManifest), /路径无效/);
const intentionalClipDesign = structuredClone(nestedDesign);
intentionalClipDesign.pages[0].children[0].clipContent = true;
intentionalClipDesign.pages[0].children[0].contentClipping = "intentional";
assert.equal(
  designCodec.normalizeDesignDocument(intentionalClipDesign).nodes[0].contentClipping,
  "intentional",
);
intentionalClipDesign.pages[0].children[0].clipContent = false;
assert.throws(
  () => designCodec.normalizeDesignDocument(intentionalClipDesign),
  /contentClipping 无效/,
);
for (const legacyField of ["layoutGrow", "layoutAlign"]) {
  const legacyDesign = structuredClone(nestedDesign);
  legacyDesign.pages[0].children[0].children[0][legacyField] =
    legacyField === "layoutGrow" ? 1 : "stretch";
  assert.throws(
    () => designCodec.normalizeDesignDocument(legacyDesign),
    new RegExp(`未知字段：${legacyField}`),
  );
}
const responsiveLayoutNodes = [
  {
    ...baseNode("responsive-row", "frame", "Responsive row"),
    x: 100,
    y: 50,
    width: 300,
    height: 100,
    layout: "horizontal",
    layoutWrap: "none",
    gap: 10,
    rowGap: 20,
    columnGap: 10,
    padding: 10,
    alignItems: "start",
    justifyContent: "start",
    alignContent: "start",
  },
  {
    ...baseNode("responsive-fixed", "rectangle", "Fixed"),
    parentId: "responsive-row",
    width: 50,
    height: 30,
    layoutAlignSelf: "end",
  },
  {
    ...baseNode("responsive-fill", "rectangle", "Fill"),
    parentId: "responsive-row",
    width: 20,
    height: 20,
    layoutSizingHorizontal: "fill",
    layoutSizingVertical: "fill",
  },
  {
    ...baseNode("responsive-overlay", "rectangle", "Overlay"),
    parentId: "responsive-row",
    x: 360,
    y: 55,
    width: 20,
    height: 20,
    layoutPositioning: "absolute",
  },
];
designLayout.applyAllAutoLayouts(responsiveLayoutNodes);
assert.equal(responsiveLayoutNodes[1].x, 110);
assert.equal(responsiveLayoutNodes[1].y, 110);
assert.equal(responsiveLayoutNodes[2].x, 170);
assert.equal(responsiveLayoutNodes[2].width, 220);
assert.equal(responsiveLayoutNodes[2].height, 80);
assert.equal(responsiveLayoutNodes[3].x, 360);
assert.equal(responsiveLayoutNodes[3].y, 55);

const constraintLayoutNodes = [
  {
    ...baseNode("constraint-frame", "frame", "Constraint frame"),
    width: 200,
    height: 100,
    layout: "horizontal",
    gap: 0,
    padding: 0,
    alignItems: "start",
    justifyContent: "start",
  },
  {
    ...baseNode("constraint-end", "rectangle", "End"),
    parentId: "constraint-frame",
    x: 160,
    y: 10,
    width: 30,
    height: 20,
    layoutPositioning: "absolute",
    constraintHorizontal: "end",
    constraintVertical: "start",
    constraintBaseWidth: 200,
    constraintBaseHeight: 100,
    constraintLeft: 160,
    constraintRight: 10,
    constraintTop: 10,
    constraintBottom: 70,
  },
  {
    ...baseNode("constraint-stretch", "rectangle", "Stretch"),
    parentId: "constraint-frame",
    x: 10,
    y: 70,
    width: 180,
    height: 10,
    layoutPositioning: "absolute",
    constraintHorizontal: "stretch",
    constraintVertical: "end",
    constraintBaseWidth: 200,
    constraintBaseHeight: 100,
    constraintLeft: 10,
    constraintRight: 10,
    constraintTop: 70,
    constraintBottom: 20,
  },
  {
    ...baseNode("constraint-scale", "rectangle", "Scale"),
    parentId: "constraint-frame",
    x: 20,
    y: 40,
    width: 40,
    height: 20,
    layoutPositioning: "absolute",
    constraintHorizontal: "scale",
    constraintVertical: "start",
    constraintBaseWidth: 200,
    constraintBaseHeight: 100,
    constraintLeft: 20,
    constraintRight: 140,
    constraintTop: 40,
    constraintBottom: 40,
  },
  {
    ...baseNode("constraint-center", "rectangle", "Center"),
    parentId: "constraint-frame",
    x: 80,
    y: 10,
    width: 40,
    height: 20,
    layoutPositioning: "absolute",
    constraintHorizontal: "center",
    constraintVertical: "start",
    constraintBaseWidth: 200,
    constraintBaseHeight: 100,
    constraintLeft: 80,
    constraintRight: 80,
    constraintTop: 10,
    constraintBottom: 70,
  },
];
constraintLayoutNodes[0].width = 300;
designLayout.applyAllAutoLayouts(constraintLayoutNodes);
assert.equal(constraintLayoutNodes[1].x, 260);
assert.equal(constraintLayoutNodes[2].width, 280);
assert.equal(constraintLayoutNodes[3].x, 30);
assert.equal(constraintLayoutNodes[3].width, 60);
assert.equal(constraintLayoutNodes[4].x, 130);
designLayout.applyAllAutoLayouts(constraintLayoutNodes);
assert.equal(constraintLayoutNodes[3].x, 30);
assert.equal(constraintLayoutNodes[3].width, 60);

const autoMarginNodes = [
  {
    ...baseNode("auto-margin-row", "frame", "Auto margin row"),
    width: 300,
    height: 60,
    layout: "horizontal",
    gap: 10,
    padding: 10,
    alignItems: "start",
    justifyContent: "start",
  },
  {
    ...baseNode("auto-margin-leading", "rectangle", "Leading"),
    parentId: "auto-margin-row",
    width: 50,
    height: 20,
  },
  {
    ...baseNode("auto-margin-trailing", "rectangle", "Trailing"),
    parentId: "auto-margin-row",
    width: 40,
    height: 20,
    layoutMarginBefore: "auto",
  },
];
designLayout.applyAllAutoLayouts(autoMarginNodes);
assert.equal(autoMarginNodes[2].x, 250);

const ellipsisLayoutNodes = [
  {
    ...baseNode("ellipsis-column", "frame", "Ellipsis column"),
    width: 120,
    height: 60,
    layout: "vertical",
    gap: 0,
    padding: 10,
    alignItems: "stretch",
    justifyContent: "start",
  },
  {
    ...baseNode("ellipsis-copy", "text", "Ellipsis copy"),
    parentId: "ellipsis-column",
    width: 240,
    height: 20,
    text: "A long filename that needs truncation",
    textSource: "A long filename that needs truncation",
    textOverflow: "ellipsis",
    textFlowWidth: 240,
    fontSize: 16,
    fontWeight: 400,
    lineHeight: 1.2,
    textAlign: "left",
    layoutSizingHorizontal: "fill",
    layoutSizingVertical: "hug",
  },
];
designLayout.applyAllAutoLayouts(ellipsisLayoutNodes);
assert.equal(ellipsisLayoutNodes[1].width, 100);
assert.equal(ellipsisLayoutNodes[1].textFlowWidth, 100);
assert.match(ellipsisLayoutNodes[1].text, /…$/u);
ellipsisLayoutNodes[0].width = 300;
designLayout.applyAllAutoLayouts(ellipsisLayoutNodes);
assert.equal(ellipsisLayoutNodes[1].width, 280);
assert.equal(ellipsisLayoutNodes[1].textFlowWidth, 280);

const wrapLayoutNodes = [
  {
    ...baseNode("wrap-row", "frame", "Wrap row"),
    width: 300,
    height: 120,
    layout: "horizontal",
    layoutWrap: "wrap",
    gap: 0,
    rowGap: 20,
    columnGap: 10,
    padding: 10,
    alignItems: "start",
    justifyContent: "start",
    alignContent: "start",
  },
  ...["a", "b", "c"].map((id) => ({
    ...baseNode(`wrap-${id}`, "rectangle", `Wrap ${id}`),
    parentId: "wrap-row",
    width: 120,
    height: 30,
  })),
];
designLayout.applyAllAutoLayouts(wrapLayoutNodes);
assert.deepEqual(
  wrapLayoutNodes.slice(1).map((node) => [node.x, node.y]),
  [
    [10, 10],
    [140, 10],
    [10, 60],
  ],
);

const hugLayoutNodes = [
  {
    ...baseNode("hug-row", "frame", "Hug row"),
    x: 20,
    y: 30,
    width: 1,
    height: 1,
    layout: "horizontal",
    gap: 8,
    padding: 12,
    alignItems: "start",
    justifyContent: "start",
    layoutSizingHorizontal: "hug",
    layoutSizingVertical: "hug",
  },
  {
    ...baseNode("hug-a", "rectangle", "Hug A"),
    parentId: "hug-row",
    width: 40,
    height: 20,
  },
  {
    ...baseNode("hug-b", "rectangle", "Hug B"),
    parentId: "hug-row",
    width: 60,
    height: 30,
  },
];
designLayout.applyAllAutoLayouts(hugLayoutNodes);
assert.equal(hugLayoutNodes[0].width, 132);
assert.equal(hugLayoutNodes[0].height, 54);
assert.deepEqual(
  hugLayoutNodes.slice(1).map((node) => [node.x, node.y]),
  [
    [32, 42],
    [80, 42],
  ],
);

const gridLayoutNodes = [
  {
    ...baseNode("grid", "frame", "Grid"),
    width: 320,
    height: 160,
    layout: "grid",
    gridColumns: 3,
    gap: 0,
    rowGap: 10,
    columnGap: 10,
    padding: 10,
    alignItems: "start",
    justifyContent: "start",
    alignContent: "start",
  },
  {
    ...baseNode("grid-wide", "rectangle", "Grid wide"),
    parentId: "grid",
    width: 20,
    height: 30,
    gridColumnSpan: 2,
    layoutSizingHorizontal: "fill",
  },
  {
    ...baseNode("grid-side", "rectangle", "Grid side"),
    parentId: "grid",
    width: 20,
    height: 30,
    layoutSizingHorizontal: "fill",
  },
  {
    ...baseNode("grid-next", "rectangle", "Grid next"),
    parentId: "grid",
    width: 20,
    height: 30,
    layoutSizingHorizontal: "fill",
  },
];
designLayout.applyAllAutoLayouts(gridLayoutNodes);
assert.equal(gridLayoutNodes[1].x, 10);
assert.equal(gridLayoutNodes[1].width, 196.67);
assert.equal(gridLayoutNodes[2].x, 216.67);
assert.equal(gridLayoutNodes[3].y, 50);
const manualOnlyNodes = Array.from({ length: 12 }, (_, index) => ({
  ...baseNode(`manual-frame-${index + 1}`, "frame", `Manual frame ${index + 1}`),
  x: (index % 6) * 120,
  y: Math.floor(index / 6) * 120,
  layout: "none",
  gap: 0,
  padding: 0,
  alignItems: "start",
  justifyContent: "start",
}));
const manualOnlyDocument = {
  canvas: { width: 1000, height: 800, background: "#eeeeee" },
  nodes: manualOnlyNodes,
};
assert(
  designAudit
    .auditDesign(manualOnlyDocument)
    .some((issue) => issue.code === "layout.manual-only-ui"),
);
assert(
  !designAudit
    .auditDesign({
      ...manualOnlyDocument,
      nodes: manualOnlyNodes.map((node, index) =>
        index === 0 ? { ...node, layout: "horizontal" } : node,
      ),
    })
    .some((issue) => issue.code === "layout.manual-only-ui"),
);
const clippedParent = {
  ...baseNode("clipped-parent", "frame", "Clipped parent"),
  width: 50,
  height: 50,
  clipContent: true,
  layout: "none",
  gap: 0,
  padding: 0,
  alignItems: "start",
  justifyContent: "start",
};
const clippedChild = {
  ...baseNode("clipped-child", "rectangle", "Clipped child"),
  parentId: clippedParent.id,
  x: 40,
  y: 10,
  width: 30,
  height: 30,
};
assert(
  designAudit
    .auditDesign({ ...manualOnlyDocument, nodes: [clippedParent, clippedChild] })
    .some((issue) => issue.code === "layout.parent-overflow" && issue.blocking),
);
assert(
  !designAudit
    .auditDesign({
      ...manualOnlyDocument,
      nodes: [{ ...clippedParent, contentClipping: "intentional" }, clippedChild],
    })
    .some((issue) => issue.code === "layout.parent-overflow"),
);
const browserTextParent = {
  ...baseNode("browser-text-parent", "frame", "Browser text parent"),
  width: 100,
  height: 18,
  fill: "transparent",
  layout: "vertical",
  gap: 0,
  padding: 0,
  alignItems: "start",
  justifyContent: "start",
};
const browserTextChild = {
  ...baseNode("browser-text-child", "text", "Browser text child"),
  parentId: browserTextParent.id,
  x: 0,
  y: 2.5,
  width: 80,
  height: 18,
  text: "Browser text",
  fontSize: 14,
  fontWeight: 400,
  lineHeight: 1.2,
  textAlign: "left",
  textMeasurement: "browser",
};
assert(
  !designAudit
    .auditDesign({
      ...manualOnlyDocument,
      nodes: [browserTextParent, browserTextChild],
    })
    .some((issue) => issue.code === "layout.parent-overflow"),
);
assert(
  designAudit
    .auditDesign({
      ...manualOnlyDocument,
      nodes: [browserTextParent, { ...browserTextChild, textMeasurement: undefined }],
    })
    .some((issue) => issue.code === "layout.parent-overflow"),
);
const defaultDesignEntry = {
  path: designRepository.DEFAULT_DESIGN_PATH,
  modifiedAt: 10,
};
assert.equal(
  designRepository.chooseRepoDesignFile([
    { path: "designs/newest.codesign.json", modifiedAt: 100 },
    defaultDesignEntry,
  ]),
  defaultDesignEntry,
);
assert.equal(
  designRepository.chooseRepoDesignFile([
    { path: "designs/older.codesign.json", modifiedAt: 10 },
    { path: "designs/newer.codesign.json", modifiedAt: 100 },
  ]).path,
  "designs/newer.codesign.json",
);
const frontendHtml = designFrontend.exportDesignFrontend(nestedDesign);
assert.match(frontendHtml, /data-codeshell-id="frame"/);
assert.match(frontendHtml, /display:grid/);
assert.match(frontendHtml, /grid-template-columns:repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(frontendHtml, /data-codeshell-id="absolute-badge"/);
assert.match(frontendHtml, /right:10px/);
assert(designFrontend.isSafeFrontendPath("design-output/index.html"));
assert(!designFrontend.isSafeFrontendPath("../index.html"));
const identicalComparison = designComparison.compareDesignDocuments(nestedDesign, nestedDesign);
assert.equal(identicalComparison.passed, true);
assert.equal(identicalComparison.coverage, 1);
const movedDesign = structuredClone(nestedDesign);
movedDesign.pages[0].children[0].children[0].width += 12;
const movedComparison = designComparison.compareDesignDocuments(nestedDesign, movedDesign);
assert.equal(movedComparison.passed, false);
assert.equal(movedComparison.maximumGeometryDelta, 12);
const parsedBrief = productBrief.parseProductBrief(
  "# Inbox\n\n## 目标\n- 更快回复客户\n\n## 需求\n- [P0] 会话列表 验收：可以选择会话\n\n## 页面\n- 收件箱：列表与聊天区",
  { path: "docs/PRD.md" },
);
assert.equal(parsedBrief.title, "Inbox");
assert.equal(parsedBrief.requirements[0].priority, "P0");
assert.equal(parsedBrief.requirements[0].acceptanceCriteria[0], "可以选择会话");
assert.equal(parsedBrief.screens[0].name, "收件箱");
assert.match(
  productBrief.productBriefPrompt(parsedBrief, {
    designPath: "designs/inbox.codesign.json",
  }),
  /Auto Layout/,
);

const quant = await import(pathToFileURL(join(repositoryRoot, "apps/quant-lab/app/engine.mjs")));
const bars = quant.generateDemoBars(260);
const run = quant.runBacktest(bars, {
  strategy: { type: "sma-cross", fast: 20, slow: 50 },
  initialCapital: 100_000,
  feeBps: 5,
  slippageBps: 2,
  stopLossPct: 8,
});
assert.equal(run.equity.length, 260);
assert(Number.isFinite(run.metrics.finalEquity));

// v1 configurations must keep producing v1 numbers after the sizer, signal-mode
// and risk-free-rate additions.
const legacyBaseline = quant.runBacktest(bars, {
  strategy: { type: "sma-cross", fast: 20, slow: 50 },
  initialCapital: 100_000,
  feeBps: 5,
  slippageBps: 2,
  stopLossPct: 8,
  sizer: { type: "all-in" },
  signalMode: "state",
  riskFreeRate: 0,
});
assert.equal(legacyBaseline.metrics.finalEquity, run.metrics.finalEquity);
assert.equal(legacyBaseline.metrics.sharpe, run.metrics.sharpe);

// Frozen v0.1.0 outputs for a fixed seed. Comparing defaults against explicit
// defaults would pass even if both regressed together, so pin the actual
// numbers the pre-sizer engine produced.
assert.equal(run.trades.length, 2);
assert.equal(run.metrics.finalEquity.toFixed(6), "156927.753986");
assert.equal(run.metrics.sharpe.toFixed(6), "3.330226");
assert.equal(run.metrics.maximumDrawdown.toFixed(6), "-0.110149");
assert.equal(run.metrics.benchmarkReturn.toFixed(6), "0.704951");

// Edge signals fire once per crossing rather than on every bar the state holds.
const edgeSignalBars = quant.generateDemoBars(400);
const edgeConfiguration = {
  strategy: { type: "sma-cross", fast: 10, slow: 30 },
  initialCapital: 100_000,
  feeBps: 5,
  slippageBps: 5,
  stopLossPct: 5,
};
const stateRun = quant.runBacktest(edgeSignalBars, edgeConfiguration);
const edgeRun = quant.runBacktest(edgeSignalBars, { ...edgeConfiguration, signalMode: "edge" });
assert(edgeRun.trades.length <= stateRun.trades.length);
assert.throws(
  () => quant.runBacktest(edgeSignalBars, { ...edgeConfiguration, signalMode: "sometimes" }),
  /signalMode/,
);

// A fixed fraction commits less capital, so it cannot outrun all-in on a winner.
const sizingBaseline = {
  strategy: { type: "sma-cross", fast: 20, slow: 50 },
  initialCapital: 100_000,
  feeBps: 5,
  slippageBps: 2,
  stopLossPct: 8,
};
// Vary only the sizer, so the comparison isolates sizing from execution costs.
const fullSized = quant.runBacktest(bars, sizingBaseline);
const halfSized = quant.runBacktest(bars, {
  ...sizingBaseline,
  sizer: { type: "fixed-fraction", pct: 50 },
});
assert.equal(fullSized.metrics.finalEquity, run.metrics.finalEquity);
assert(halfSized.metrics.finalEquity < fullSized.metrics.finalEquity);
assert.equal(halfSized.trades.length, fullSized.trades.length);
assert.throws(
  () => quant.runBacktest(bars, { ...edgeConfiguration, sizer: { type: "fixed-fraction", pct: 0 } }),
  /sizer percentage/,
);
assert.throws(
  () => quant.runBacktest(bars, { ...edgeConfiguration, sizer: { type: "leveraged" } }),
  /unknown sizer type/,
);
// The engine has no borrowing model, so leverage above 1 must be rejected.
assert.throws(
  () =>
    quant.runBacktest(bars, {
      ...edgeConfiguration,
      sizer: { type: "volatility-target", annual: 15, maxLeverage: 3 },
    }),
  /max leverage/,
);

// A positive risk-free rate lowers Sharpe for a profitable strategy.
const withRiskFree = quant.runBacktest(bars, {
  strategy: { type: "sma-cross", fast: 20, slow: 50 },
  initialCapital: 100_000,
  feeBps: 5,
  slippageBps: 2,
  stopLossPct: 8,
  riskFreeRate: 0.03,
});
assert(withRiskFree.metrics.sharpe < run.metrics.sharpe);

// Parameter sweeps report invalid combinations instead of aborting the grid.
const sweep = quant.parameterSweep(
  bars,
  { ...edgeConfiguration, strategy: { type: "sma-cross" } },
  { fast: [5, 10, 60], slow: [30, 50] },
);
assert.equal(sweep.evaluated, 6);
assert(sweep.usable < sweep.evaluated, "fast >= slow combinations must be rejected, not thrown");
assert(sweep.results.some((entry) => entry.ok === false));
assert(Number.isFinite(sweep.sharpeMean));

// Walk-forward selects on the in-sample window and scores the untouched one.
const walkBars = quant.generateDemoBars(900);
const walkResult = quant.walkForward(
  walkBars,
  { ...edgeConfiguration, strategy: { type: "sma-cross" } },
  { fast: [10, 20], slow: [50, 100] },
  { inSampleBars: 400, outOfSampleBars: 100 },
);
assert(walkResult.usableFolds >= 2);
assert(walkResult.folds.every((fold) => !fold.ok || fold.from < fold.to));
assert(Number.isFinite(walkResult.meanInSampleFoldSharpe));
assert(Number.isFinite(walkResult.pooledOutOfSampleSharpe));
assert.equal(walkResult.failedFolds, 0);
assert(Number.isInteger(walkResult.untestedTailBars) && walkResult.untestedTailBars >= 0);

// Warm-up history must keep an in-sample-valid parameter usable out of sample.
// Without it a lookback longer than the fold fails every fold (regression).
const warmupWalk = quant.walkForward(
  quant.generateDemoBars(300),
  { ...edgeConfiguration, strategy: { type: "sma-cross" } },
  { fast: [5], slow: [49] },
  { inSampleBars: 100, outOfSampleBars: 50 },
);
assert.equal(warmupWalk.failedFolds, 0);
assert(warmupWalk.usableFolds >= 3);
assert(warmupWalk.warmupBars > 0);
assert(warmupWalk.folds.every((fold) => !fold.ok || fold.returns === undefined));

// Pooled Sharpe is computed over the concatenated stream, not averaged ratios,
// so the two summaries are allowed to differ and both must be finite.
assert(Number.isFinite(warmupWalk.meanOutOfSampleFoldSharpe));
assert(Number.isFinite(warmupWalk.pooledOutOfSampleSharpe));

// Warm-up bars prime indicators but must never trade: a position opened there
// would use parameters selected from data that comes after it.
const warmupProbeBars = quant.generateDemoBars(300);
const warmupProbe = quant.walkForward(
  warmupProbeBars,
  { ...edgeConfiguration, stopLossPct: 0, strategy: { type: "sma-cross" } },
  { fast: [5], slow: [20] },
  { inSampleBars: 100, outOfSampleBars: 50 },
);
for (const fold of warmupProbe.folds.filter((entry) => entry.ok)) {
  const sliceStart = warmupProbeBars.findIndex((bar) => bar.date === fold.from) - fold.warmupBars;
  const evaluation = warmupProbeBars.slice(sliceStart, sliceStart + fold.warmupBars + 50);
  const replay = quant.runBacktest(evaluation, {
    ...edgeConfiguration,
    stopLossPct: 0,
    strategy: { type: "sma-cross", ...fold.parameters },
    tradingFromIndex: fold.warmupBars,
  });
  assert(
    replay.trades.every((trade) => trade.entryDate >= fold.from),
    "no trade may be entered inside the warm-up prefix",
  );
  for (let i = 0; i < fold.warmupBars; i += 1) {
    assert.equal(replay.equity[i].value, 100_000, "warm-up equity must stay at initial capital");
  }
}
assert.throws(
  () => quant.runBacktest(warmupProbeBars, { ...edgeConfiguration, tradingFromIndex: -1 }),
  /tradingFromIndex/,
);

// Default warm-up must cover the longest lookback in the grid, or an in-sample
// valid parameter set fails every fold for lack of history.
const shortFoldWalk = quant.walkForward(
  quant.generateDemoBars(300),
  { ...edgeConfiguration, stopLossPct: 0, strategy: { type: "sma-cross" } },
  { fast: [2], slow: [50] },
  { inSampleBars: 100, outOfSampleBars: 10 },
);
assert(shortFoldWalk.warmupBars >= 52);
assert(shortFoldWalk.usableFolds >= 15);

// A numeric-string risk-free rate must not string-concatenate in pooled Sharpe.
const rateWalk = (rate) =>
  quant.walkForward(
    quant.generateDemoBars(300),
    { ...edgeConfiguration, stopLossPct: 0, riskFreeRate: rate, strategy: { type: "sma-cross" } },
    { fast: [5], slow: [20] },
    { inSampleBars: 100, outOfSampleBars: 50 },
  ).pooledOutOfSampleSharpe;
assert.equal(rateWalk("0.03").toFixed(9), rateWalk(0.03).toFixed(9));

// A zero-trade parameter set must not win a sweep over a traded candidate.
const zeroTradeSweep = quant.parameterSweep(
  quant.generateDemoBars(300),
  { ...edgeConfiguration, strategy: { type: "rsi-reversion", period: 14 } },
  { oversold: [1, 30], overbought: [70, 99] },
);
assert(zeroTradeSweep.usable > zeroTradeSweep.eligible);
assert(zeroTradeSweep.best.trades >= 1);

// Volatility targeting without enough history must not silently swallow the
// entry signal; edge mode would otherwise never fire it again.
const sizerBars = quant.generateDemoBars(300);
const edgeBase = {
  ...edgeConfiguration,
  stopLossPct: 0,
  signalMode: "edge",
  strategy: { type: "sma-cross", fast: 10, slow: 30 },
};
const allInEdge = quant.runBacktest(sizerBars, edgeBase);
const volTargetEdge = quant.runBacktest(sizerBars, {
  ...edgeBase,
  sizer: { type: "volatility-target", annual: 15, lookback: 250 },
});
assert.equal(volTargetEdge.trades.length, allInEdge.trades.length);
assert(Array.isArray(volTargetEdge.skippedEntries));
assert.throws(
  () =>
    quant.walkForward(
      quant.generateDemoBars(120),
      { ...edgeConfiguration, strategy: { type: "sma-cross" } },
      { fast: [10], slow: [50] },
      { inSampleBars: 400, outOfSampleBars: 100 },
    ),
  /at least 500 bars/,
);

// Drawdown episodes are ordered worst-first and stay within the equity window.
// Watchlist alerts reuse the backtest signal rules, so an alert can be checked
// by the same walk-forward machinery instead of being an unverifiable heuristic.
const watchBars = quant.generateDemoBars(300);
const lastClose = watchBars.at(-1).close;

const priceHit = quant.evaluateWatchItem(watchBars, {
  symbol: "TEST",
  rule: { type: "price-below", price: lastClose * 2 },
});
assert.equal(priceHit.triggered, true);
assert.equal(priceHit.asOf, watchBars.at(-1).date);

const priceMiss = quant.evaluateWatchItem(watchBars, {
  symbol: "TEST",
  rule: { type: "price-below", price: lastClose / 2 },
});
assert.equal(priceMiss.triggered, false);

// An always-true RSI threshold must fire; an impossible one must not.
assert.equal(
  quant.evaluateWatchItem(watchBars, {
    symbol: "TEST",
    rule: { type: "rsi-oversold", period: 14, threshold: 99 },
  }).triggered,
  true,
);
assert.equal(
  quant.evaluateWatchItem(watchBars, {
    symbol: "TEST",
    rule: { type: "rsi-oversold", period: 14, threshold: 1 },
  }).triggered,
  false,
);

// A signal alert fires on the same edge the backtester would trade on.
const signalWatch = quant.evaluateWatchItem(watchBars, {
  symbol: "TEST",
  rule: { type: "signal-entry" },
  strategy: { type: "sma-cross", fast: 10, slow: 30 },
});
// The alert must agree with the engine: it fires exactly when the final bar
// carries an entry edge, which is the bar the backtester would buy on.
const signalRun = quant.runBacktest(watchBars, {
  ...edgeConfiguration,
  stopLossPct: 0,
  signalMode: "edge",
  strategy: { type: "sma-cross", fast: 10, slow: 30 },
});
const entryOnFinalBar = signalRun.trades.some(
  (trade) => trade.entryDate === watchBars.at(-1).date,
);
assert.equal(
  signalWatch.triggered || entryOnFinalBar,
  signalWatch.triggered,
  "alert and backtester must agree on the final bar",
);
assert.equal(typeof signalWatch.detail, "string");

assert.throws(
  () => quant.evaluateWatchItem(watchBars, { symbol: "T", rule: { type: "nope" } }),
  /unknown alert rule/,
);
assert.throws(
  () => quant.evaluateWatchItem(watchBars, { symbol: "T", rule: { type: "price-below", price: -1 } }),
  /alert price/,
);
assert.throws(
  () => quant.evaluateWatchItem([watchBars[0]], { symbol: "T", rule: { type: "price-below", price: 1 } }),
  /at least two bars/,
);
// A signal alert with no strategy must fail loudly rather than silently never firing.
assert.throws(
  () => quant.evaluateWatchItem(watchBars, { symbol: "T", rule: { type: "signal-entry" } }),
  /needs a strategy/,
);

// Ranking puts triggered entries first, then the closest to triggering.
const ranked = quant.rankWatchResults([
  { symbol: "C", triggered: false, distance: 0.5 },
  { symbol: "A", triggered: true, distance: null },
  { symbol: "B", triggered: false, distance: 0.01 },
]);
assert.deepEqual(
  ranked.map((entry) => entry.symbol),
  ["A", "B", "C"],
);

// app.js is browser-side and never imported here, so a syntax error in it would
// otherwise ship undetected. Parse it (and the CLI) as modules.
for (const relativePath of [
  "apps/quant-lab/app/app.js",
  "apps/quant-lab/app/news-feed.mjs",
  "apps/quant-lab/app/modules/news-ui.mjs",
  "apps/quant-lab/app/tools/fetch-news.mjs",
  "apps/quant-lab/app/tools/fetch-market-data.mjs",
]) {
  const absolutePath = join(repositoryRoot, relativePath);
  const parsed = spawnSync(process.execPath, ["--check", absolutePath], { encoding: "utf8" });
  if (parsed.status !== 0) {
    throw new Error(`${relativePath} failed to parse:\n${parsed.stderr.trim()}`);
  }
}

const episodes = quant.drawdownEpisodes(run.equity, 3);
assert(episodes.length <= 3);
for (let i = 1; i < episodes.length; i += 1) {
  assert(episodes[i - 1].depth <= episodes[i].depth);
}
for (const episode of episodes) {
  assert(episode.depth < 0);
  assert(episode.peakDate <= episode.troughDate);
}

// Evidence carries engine-computed numbers plus the concerns a reviewer needs.
const evidence = quant.researchEvidence(run, { walkForward: walkResult, sweep });
assert.equal(evidence.metrics.finalEquity, run.metrics.finalEquity);
assert.equal(evidence.sample.bars, 260);
assert(Array.isArray(evidence.concerns));
const missingValidation = quant.researchEvidence(run);
assert(missingValidation.concerns.some((note) => /out-of-sample/.test(note)));

for (const result of results) {
  console.log(`✓ ${result.id}: ${result.files} files`);
}
console.log("✓ Design Studio geometry smoke test");
console.log("✓ Design Studio v3 recursive document smoke test");
console.log("✓ Design Studio responsive layout smoke test");
console.log("✓ Design Studio manual-only layout quality audit");
console.log("✓ Design Studio default repository file selection");
console.log("✓ Design Studio PRD → frontend → comparison smoke test");
console.log("✓ Quant Lab engine smoke test");
console.log("✓ Quant Lab sizer, signal-mode and risk-free-rate contract");
console.log("✓ Quant Lab walk-forward and parameter sweep");
console.log("✓ Quant Lab research evidence");
console.log("✓ Quant Lab watchlist alert rules");

// Preserve existing app regressions while validating new prebuilt packages with
// the shared installer contract. Source directories are never install targets.
runSchemaPatternTests();
const sourcePackages = (await discoverProjects())
  .filter((project) => project.mode === "source")
  .map((project) => relative(repositoryRoot, project.output).split(sep).join("/"));
for (const packagePath of sourcePackages) {
  const result = await validateSourcePackage(packagePath);
  console.log(`✓ ${result.id}: ${result.files} files`);
}
await validateSourceSyntax(sourcePackages);
