import assert from "node:assert/strict";
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

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = [
  "apps/design-studio",
  "apps/job-hunt-hq",
  "apps/quant-lab",
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
      [...appScript.matchAll(/register\("([a-z][a-z0-9_]*)"/g)].map((match) => match[1]),
    );
    const queriedIds = [
      ...appScript.matchAll(/document\.querySelector\("#([a-z0-9-]+)"\)/g),
    ].map((match) => match[1]);
    assert.equal(manifest.version, "0.18.0", `${packagePath}: responsive-layout version mismatch`);
    assert.deepEqual(
      [...registeredToolNames].sort(),
      [...toolNames].sort(),
      `${packagePath}: manifest tools and registered handlers must match`,
    );
    for (const id of queriedIds) {
      assert.match(html, new RegExp(`id="${id}"`), `${packagePath}: missing #${id}`);
    }
    for (const toolName of [
      "read_product_brief",
      "generate_frontend",
      "compare_frontend",
    ]) {
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
  if (manifest.id === "job-hunt-hq") {
    const appScript = await readFile(join(root, "app", "app.js"), "utf8");
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
      await readFile(
        join(root, "app", "formats", "job-hunt-panel-v2.schema.json"),
        "utf8",
      ),
    );
    const toolNames = new Set(manifest.agent.tools.map((tool) => tool.name));
    const registeredToolNames = new Set(
      [...appScript.matchAll(/register\("([a-z][a-z0-9_]*)"/g)].map((match) => match[1]),
    );
    const queriedIds = [
      ...appScript.matchAll(/document\.querySelector\("#([a-z0-9-]+)"\)/g),
    ].map((match) => match[1]);
    assert.equal(manifest.version, "1.25.0", `${packagePath}: guided workflow version mismatch`);
    assert(
      manifest.permissions.includes("credentials.cookies"),
      `${packagePath}: channel login needs the host-owned Cookie permission`,
    );
    assert(
      manifest.permissions.includes("automations.manage"),
      `${packagePath}: scheduled discovery needs project-scoped automation permission`,
    );
    assert.deepEqual(
      [...registeredToolNames].sort(),
      [...toolNames].sort(),
      `${packagePath}: manifest tools and registered handlers must match`,
    );
    for (const id of queriedIds) {
      assert.match(html, new RegExp(`id="${id}"`), `${packagePath}: missing #${id}`);
    }
    assert(toolNames.has("save_candidate_context"), `${packagePath}: context tool is required`);
    assert(toolNames.has("save_job_research"), `${packagePath}: research tool is required`);
    assert(toolNames.has("save_workflow_progress"), `${packagePath}: workflow tool is required`);
    assert(toolNames.has("report_execution_trace"), `${packagePath}: trace tool is required`);
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
      toolNames.has("save_preparation_plan"),
      `${packagePath}: preparation plan tool is required`,
    );
    assert(
      toolNames.has("save_interview_debrief"),
      `${packagePath}: interview debrief tool is required`,
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
      /data-status-filter="inbox"/,
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
    assert(
      html.indexOf('class="workbench"') < html.indexOf('id="workflow-builder"'),
      `${packagePath}: users must see jobs before composing downstream tasks`,
    );
    assert.match(
      html,
      /data-status-filter="interview"/,
      `${packagePath}: interview-stage grouping is required`,
    );
    assert.match(
      html,
      /data-status-filter="closed"/,
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
      /projectSnapshotSaveQueue/,
      `${packagePath}: project snapshot writes must be serialized`,
    );
    assert.match(
      appScript,
      /function generateLocalDraft[\s\S]*?const markdown = composeDraft\(job, category\)/,
      `${packagePath}: preview resume generation must build its draft in scope`,
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
      "generate-commit-interview",
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
      html,
      /id="interview-debrief-list"/,
      `${packagePath}: interview debrief view is required`,
    );
    assert.match(
      html,
      /data-resume-mode="jd"/,
      `${packagePath}: JD display mode is required`,
    );
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
      `${packagePath}: dashboard must expose data sources before job discovery`,
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
    assert.match(
      appScript,
      /materialsSourceOverviewSlot\.append\(sourceOverviewPanel\)/,
      `${packagePath}: source overview belongs to the data source page`,
    );
    assert.match(
      appStyle,
      /color-scheme:\s*light/,
      `${packagePath}: main panel theme must remain light`,
    );
    assert.match(
      html,
      /id="job-search-query"/,
      `${packagePath}: JD pool needs direct search`,
    );
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
      /Cookie 直接进入 CodeShell 凭证库/,
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
    assert.match(
      skill,
      /base_resume_id/,
      `${packagePath}: Skill must preserve variant lineage`,
    );
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
    assert.match(skill, /pass that exact ID to every non-readonly/, `${packagePath}: Skill must pass trace_id`);
    assert.match(
      skill,
      /finish with `complete_execution_trace`/,
      `${packagePath}: Skill must explicitly finish Panel traces`,
    );
    assert.match(
      skill,
      /commit:<sha>/,
      `${packagePath}: Skill must define commit question evidence`,
    );
    assert.match(
      html,
      /data-workflow-task="commits"/,
      `${packagePath}: Commit deep-dive task is required`,
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
    const claimSchema = resumeTool.inputSchema.properties.claim_evidence.items;
    assert(claimSchema.required.includes("importance"));
    assert(claimSchema.required.includes("why_it_matters"));
    assert(claimSchema.required.includes("interview_questions"));
    assert(claimSchema.properties.sources.items.required.includes("evidence"));
    const questionTool = manifest.agent.tools.find(
      (tool) => tool.name === "save_interview_question_set",
    );
    assert(questionTool.inputSchema.required.includes("source_mode"));
    assert(!questionTool.inputSchema.required.includes("job_id"));
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
    const keyByMetadata = (job) =>
      [job.sourceId, job.company, job.title, job.location].join("|");
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
      selectedInterviewSetId: "set-trash",
      preparationPlans: [{ id: "plan-trash", jobId: "job-trash" }],
      interviewDebriefs: [{ id: "debrief-trash", jobId: "job-trash" }],
    };
    assert.equal(jobRemovalPreview(removalState, "job-trash").linkedArtifactCount, 6);
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
    assert.equal(removedJob.next.preparationPlans.length, 0);
    assert.equal(removedJob.next.interviewDebriefs.length, 0);

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
    } = await import(
      pathToFileURL(join(root, "app", "discovery-model.mjs"))
    );
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
      normalizeDiscoveryPreferences(
        { providers: [] },
        { validProviderIds: ["boss", "official"] },
      ).providers,
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
      resolveChannelVerificationForSession(
        "boss",
        normalizedVerifications,
        "session-current",
      ).state,
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
    assert.equal(
      resolveCareerCurrentStep({ projectReady: true, hasBase: false }),
      "base",
    );
    assert.equal(
      resolveCareerCurrentStep({ projectReady: true, hasBase: true }),
      "inbox",
    );
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

    const {
      normalizePreparationGapKind,
      normalizeRoadmapMilestone,
      preparationGapCounts,
    } = await import(pathToFileURL(join(root, "app", "roadmap-model.mjs")));
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
      extractResumeClaims,
      isSupportedResumePhoto,
      normalizeResumeRecord,
      normalizeResumeStyle,
      resumeClaimStrength,
      resumeEvidenceCoverage,
      selectBaseResume,
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
    assert.equal(legacyVariant.kind, "variant");
    assert.equal(legacyVariant.jobId, "job-existing");
    assert.deepEqual(legacyBase.style, {
      template: "editorial",
      density: "comfortable",
    });
    assert.deepEqual(
      normalizeResumeStyle({ template: "minimal", density: "compact" }),
      { template: "minimal", density: "compact" },
    );
    assert.deepEqual(
      normalizeResumeStyle({ template: "unknown", density: "tiny" }),
      { template: "editorial", density: "comfortable" },
    );
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
    const resumeRecords = collectResumeRecords(legacyVariant, [legacyBase, legacyVariant]);
    assert.equal(resumeRecords.length, 2);
    assert.deepEqual(baseResumeRecords(resumeRecords).map((resume) => resume.versionId), [
      "resume-base",
    ]);
    assert.equal(selectBaseResume(resumeRecords, "resume-base")?.versionId, "resume-base");
    assert.equal(isSupportedResumePhoto("data:image/jpeg;base64,Zm9v"), true);
    assert.equal(isSupportedResumePhoto("https://example.test/photo.jpg"), false);
    const sourcedMarkdown = [
      "# Candidate",
      "## Skills",
      "- Built a resumable agent runtime",
      "- Reduced long-session rendering work",
    ].join("\n");
    assert.deepEqual(extractResumeClaims(sourcedMarkdown), [
      "Built a resumable agent runtime",
      "Reduced long-session rendering work",
    ]);
    assert.deepEqual(
      extractResumeClaims("# Candidate\n## Professional Summary\nFrontend engineer with agent runtime experience."),
      ["Frontend engineer with agent runtime experience."],
    );
    assert.deepEqual(
      extractResumeClaims("# Candidate\n## Core Skills\nReact · TypeScript\nAgent workflow design"),
      ["React · TypeScript", "Agent workflow design"],
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
    assert.deepEqual(evidenceCoverage.missing, ["Reduced long-session rendering work"]);
    assert.equal(resumeClaimStrength(evidenceCoverage.mapped[0].evidence), "strong");

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
    assert.equal(
      resolveProjectBootstrapStatus({ snapshotUnreadable: true }).state,
      "blocked",
    );
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

    const {
      PANEL_LOCAL_STORAGE_TARGET_BYTES,
      compactPanelLocalState,
      encodedJsonBytes,
    } = await import(pathToFileURL(join(root, "app", "storage-model.mjs")));
    const oversizedLocalState = {
      selectedJobId: "job-existing",
      activeView: "interviews",
      profile: { photoDataUrl: `data:image/jpeg;base64,${"x".repeat(300_000)}` },
      jobs: [{ description: "JD".repeat(100_000) }],
      sessionActivity: Array.from({ length: 24 }, (_, index) => ({
        id: `trace-${index}`,
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
    assert(compactedLocalState.sessionActivity.length > 0);
    assert.equal(compactedLocalState.sessionActivity[0].outcome.status, "completed");
    assert.equal(compactedLocalState.sessionActivity[0].outcome.outputRefs[0], "resume:resume-1");
    assert.equal(
      compactedLocalState.sessionActivity[0].completedAt,
      "2026-01-01T00:00:03.000Z",
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
const hashDesignSource = async (source) =>
  createHash("sha256").update(source).digest("hex");
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
assert(
  incrementalIndexedPlan.parts.every((part) => part.pageId === "page-2"),
);
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
assert.equal(
  lazySavePlan.manifest.pages[1].sha256,
  indexedPlan.manifest.pages[1].sha256,
);
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
assert.deepEqual(
  designOperationLog.captureDesignOperationState(operationReplay),
  operationAfter,
);
designOperationLog.applyDesignOperationRecord(operationReplay, operationRecord, "reverse");
assert.deepEqual(
  designOperationLog.captureDesignOperationState(operationReplay),
  operationBefore,
);
const pixelBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const hashDesignBytes = async (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const pixelResource = await designResources.createDesignResourcePersistencePlan({
  id: "pixel-image",
  kind: "image",
  mime: "image/png",
  base64: pixelBase64,
  sha256Bytes: hashDesignBytes,
});
const duplicatePixelResource =
  await designResources.createDesignResourcePersistencePlan({
    id: "pixel-image-copy",
    kind: "image",
    mime: "image/png",
    base64: pixelBase64,
    sha256Bytes: hashDesignBytes,
  });
assert.equal(
  pixelResource.descriptor.sha256,
  duplicatePixelResource.descriptor.sha256,
);
assert.deepEqual(
  pixelResource.parts.map((part) => part.path),
  duplicatePixelResource.parts.map((part) => part.path),
);
const resolvedPixel = await designResources.resolveDesignResource({
  descriptor: pixelResource.descriptor,
  readText: async (path) =>
    pixelResource.parts.find((part) => part.path === path)?.content,
  sha256Bytes: hashDesignBytes,
});
assert.equal(resolvedPixel.base64, pixelBase64);
assert(resolvedPixel.dataUrl.startsWith("data:image/png;base64,"));
const resourceCache = new designResources.DesignResourceCache({
  resources: [pixelResource.descriptor, duplicatePixelResource.descriptor],
  readText: async (path) =>
    pixelResource.parts.find((part) => part.path === path)?.content,
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
assert(
  new TextEncoder().encode(JSON.stringify(recoveryPlan.value)).length <
    256 * 1024,
);
const resolvedRecovery = await designRecovery.resolveRecoveryPersistence({
  value: recoveryPlan.value,
  readText: async (path) =>
    recoveryPlan.parts.find((part) => part.path === path)?.content,
  sha256: hashDesignSource,
});
assert.equal(
  resolvedRecovery.record.operations[0].after.length,
  220 * 1024,
);
const indexedCheckerWorkspace = await mkdtemp(
  join(tmpdir(), "codeshell-design-index-"),
);
try {
  const primaryPath = join(
    indexedCheckerWorkspace,
    "designs",
    "indexed.codesign.json",
  );
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
  const corruptedPartPath = join(
    indexedCheckerWorkspace,
    ...indexedPlan.parts[0].path.split("/"),
  );
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
assert.equal(
  largeDesignPlan.parts.map((part) => part.content).join(""),
  largeDesignSource,
);
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
assert.throws(
  () => designBundle.normalizeDesignBundleManifest(unsafeLargeManifest),
  /路径无效/,
);
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
