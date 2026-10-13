import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
export const cliPath = fileURLToPath(new URL("../../../../apps/job-hunt-hq/app/tools/job-hunt.mjs", import.meta.url));
export const snapshotPath = "job-hunt-panel.json";

export async function tempProject(t) {
  const path = await mkdtemp(join(tmpdir(), "job-hunt-headless-test-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

export async function cli(args, { cwd, input, expectedExit = 0 } = {}) {
  let inputFile;
  if (input !== undefined) {
    const dir = await mkdtemp(join(tmpdir(), "job-hunt-cli-input-"));
    inputFile = join(dir, "input.json");
    await writeFile(inputFile, JSON.stringify(input));
    args = [...args, "--input-file", inputFile];
  }
  let completed;
  try {
    try {
      completed = { ...(await exec(process.execPath, [cliPath, ...args], { cwd, maxBuffer: 2 * 1024 * 1024 })), exitCode: 0 };
    } catch (error) {
      if (error.code === undefined || typeof error.code !== "number") throw error;
      completed = { stdout: error.stdout, stderr: error.stderr, exitCode: error.code };
    }
    assert.equal(completed.exitCode, expectedExit, completed.stderr || completed.stdout);
    assert.equal(completed.stdout.trim().split("\n").length, 1, "CLI emits one machine-readable JSON record");
    return { ...completed, json: JSON.parse(completed.stdout) };
  } finally {
    if (inputFile) await rm(join(inputFile, ".."), { recursive: true, force: true });
  }
}

export const run = (project, op, input, options = {}) =>
  cli(["run", op, "--project", project, "--session", "fixture-session"], { input, ...options });

export async function fileInventory(root, prefix = "") {
  const files = {};
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(files, await fileInventory(root, path));
    else files[path] = await readFile(join(root, path), "utf8");
  }
  return files;
}

export const candidateInput = {
  profile: { name: "Fixture Candidate", role: "Software Engineer", contact: "fixture@example.invalid", target: "Platform", summary: "Verified fixture project experience." },
  repositories: [{ id: "repo-fixture", name: "Fixture project", path: "src/fixture.mjs", tech: "JavaScript", summary: "Built a small offline fixture." }],
  work_history: [{ id: "exp-fixture", company: "Fixture Company", role: "Engineer", period: "2025–2026", achievements: ["Delivered the fixture feature."] }],
};

export const resumeClaim = "Built a complete offline fixture with verified file evidence and repeatable recovery checks.";
export const resumeInput = {
  resume_kind: "base", category: "Platform", title: "Fixture Base Resume",
  markdown: `# Fixture Candidate\n\nSoftware Engineer\n\n## Project Experience\n\n- ${resumeClaim}\n`,
  claim_evidence: [{ claim: resumeClaim, status: "verified", importance: "core", why_it_matters: "Demonstrates verified delivery.", sources: [{ kind: "file", label: "Fixture source", locator: "src/fixture.mjs", evidence: "Public fixture source confirms the implementation." }], interview_questions: [{ question: "How did you verify recovery?", focus: "Evidence" }] }],
  candidate_questions: [
    { id: "qa-decision", category: "decision", priority: "high", question: "Which design did you choose and why?", why: "The design tradeoff needs the candidate's own account." },
    { id: "qa-scope", category: "scope", priority: "medium", question: "What was the exact project scope?", why: "Avoid inferring undocumented scale." },
    { id: "qa-ownership", category: "ownership", priority: "high", question: "Which parts did you own?", why: "Separate personal work from the team's output." },
  ],
};

// Only invocation metadata is normalized. Domain fields and historical fixture
// timestamps remain visible to the equality assertion.
export function normalizeInvocation(snapshot) {
  const ids = new Map();
  for (const [index, resume] of [snapshot.resume, ...(snapshot.versions || [])].entries()) {
    if (resume?.versionId && /^resume[-_]/.test(resume.versionId)) ids.set(resume.versionId, `<resume-${index}>`);
  }
  // Career projection IDs hash the invocation's resume ID. Preserve every
  // business field while assigning those derived links the same stable name.
  const replaceResumeIds = value => {
    for (const [id, replacement] of ids) value = value.replaceAll(id, replacement);
    return value;
  };
  for (const field of ["sourceMaterials", "careerQa"]) {
    for (const record of snapshot[field] || []) {
      const reference = (record.legacyRefs || []).find(ref => ref.startsWith("resume:") && replaceResumeIds(ref) !== ref);
      if (reference) ids.set(record.id, `<${field}:${replaceResumeIds(reference)}>`);
    }
  }
  const runtimeTimes = new Set(["updatedAt", "answeredAt", "createdAt", "presentationUpdatedAt", "recordedAt", "confirmedAt", "lastConfirmedAt"]);
  const visit = (value, key = "", path = "") => {
    if (Array.isArray(value)) {
      const normalized = value.map((item, index) => visit(item, "", `${path}[${index}]`));
      return ["sourceIds", "episodeIds", "qaIds"].includes(key) ? normalized.sort() : normalized;
    }
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, visit(item, name, `${path}.${name}`)]));
    if (typeof value === "string" && ids.has(value)) return ids.get(value);
    if (runtimeTimes.has(key) && typeof value === "string" && Date.parse(value) > Date.parse("2026-01-02T00:00:00Z")) return "<invocation-time>";
    if (key === "source" && /^\.(resume|versions\[\d+\])\./.test(path) && ["panel", "cli"].includes(value)) return "<adapter-source>";
    return typeof value === "string" ? replaceResumeIds(value) : value;
  };
  return visit(snapshot);
}
