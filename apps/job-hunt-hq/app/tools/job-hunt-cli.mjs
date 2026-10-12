#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createNodeProjectStore, projectStoreError } from "../node-project-store.mjs";
import { validatePanelToolInput } from "../tool-input-validation.mjs";
import { migrateCareerLibrary } from "../career-library-model.mjs";
import { runCareerCandidateOperation } from "../career-service.mjs";
import { prepareResumeDraft, prepareResumeQaAnswer } from "../resume-service.mjs";
import { buildJobSearchContext, jobSearchContextQuery } from "../job-search-context-model.mjs";
import { collectResumeRecords } from "../resume-model.mjs";
import { readCareerLibraryVersion } from "../career-library-version-store.mjs";
import { prepareProjectSnapshotDocuments, projectSnapshotShardDescriptors, hydrateProjectSnapshotDocuments } from "../snapshot-sharding-model.mjs";
import { writeProjectSnapshotDocuments } from "../snapshot-storage.mjs";

const MANIFEST = JSON.parse(readFileSync(new URL("../../.codeshell-panel/panel.json", import.meta.url), "utf8"));
const SUPPORTED = ["get_job_search_context", "save_candidate_context", "save_resume_draft", "save_resume_qa_answer"];
const INPUT_LIMIT = 64 * 1024;
const OUTPUT_LIMIT = 512 * 1024;
const plain = value => value && typeof value === "object" && !Array.isArray(value);
function fields(value, allowed, label) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) throw projectStoreError("INVALID_INPUT", `${label}含未知字段或不是JSON对象`);
}
function candidateMode(input) {
  const modes = ["source", "episode", "qa", "library_version", "career_update"].filter(key => Object.hasOwn(input, key));
  if (modes.length !== 1) throw projectStoreError("UNSUPPORTED", "独立经历库入口使用source、episode、qa、library_version或career_update中的一种；旧的候选人全量替换仍由原面板工具提供");
  return modes[0];
}
function ensureRevision(value) {
  if (value !== null && (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value))) throw projectStoreError("INVALID_INPUT", "写操作必须使用读取结果的expectedRevision；新建项目使用null");
}
export async function executeJobHuntRequest(request, { project = process.cwd() } = {}) {
  fields(request, ["operation", "input", "expectedRevision", "sessionId"], "request");
  if (typeof request.operation !== "string") throw projectStoreError("INVALID_INPUT", "operation为必填");
  if (request.sessionId !== undefined && (typeof request.sessionId !== "string" || request.sessionId.length > 240)) throw projectStoreError("INVALID_INPUT", "sessionId最多240字符");
  if (request.operation === "ops") return { ok: true, result: { format: "codeshell.job-hunt.cli", schemaVersion: 1,
    operations: MANIFEST.agent.tools.filter(tool => SUPPORTED.includes(tool.name)).map(tool => ({ ...tool,
      ...(tool.name === "save_candidate_context" ? { supportedModes: ["source", "episode", "qa", "library_version", "career_update"] } : {}) })),
    writePolicy: "All mutations require expectedRevision from a fresh read (null for a new project). JSON preview never writes. Saving a knowledge version does not confirm facts or generate a resume." } };
  const store = createNodeProjectStore(project);
  if (request.operation === "snapshot.commit") {
    fields(request.input, ["path", "expectedRevision", "expectedModifiedAt"], "snapshot.commit");
    if (!/^career-data\/panel-commits\/g-[a-f0-9]{32}\.json$/.test(request.input.path || "")) throw projectStoreError("INVALID_PATH", "主文件提交只接受本项目的create-only staged文件");
    const staged = store.read(request.input.path);
    const root = JSON.parse(staged.content);
    if (![1, 2].includes(root?.schemaVersion) || Array.isArray(root)) throw projectStoreError("INVALID_INPUT", "暂存快照版本无效");
    const shards = new Map();
    for (const descriptor of projectSnapshotShardDescriptors(root)) shards.set(descriptor.path, JSON.parse(store.read(descriptor.path).content));
    hydrateProjectSnapshotDocuments(root, shards);
    const result = store.write({ path: "job-hunt-panel.json", content: staged.content,
      ...(Object.hasOwn(request.input, "expectedRevision") ? { expectedRevision: request.input.expectedRevision } : {}),
      ...(Object.hasOwn(request.input, "expectedModifiedAt") ? { expectedModifiedAt: request.input.expectedModifiedAt } : {}) });
    return { ok: true, result, revision: result.revision };
  }
  const tool = MANIFEST.agent.tools.find(tool => tool.name === request.operation && SUPPORTED.includes(tool.name));
  if (!tool) throw projectStoreError("UNSUPPORTED", `不支持的operation：${request.operation}`);
  validatePanelToolInput(tool.inputSchema, request.input);
  const loaded = await store.load();
  // Preserve raw existing facts before the shared service validates a mutation;
  // normalizing the whole library here could truncate legacy text before the
  // incremental update's preservation checks get to inspect it.
  const defaults = { profile: {}, jobs: [], resume: {}, versions: [], sourceMaterials: [], careerEpisodes: [], careerQa: [], careerLibraryVersions: [] };
  const source = { ...defaults, ...loaded.state };
  const current = Number(source.careerLibraryMigrationVersion || 0) < 1 && !["sourceMaterials", "careerEpisodes", "careerQa"].some(key => source[key].length)
    ? migrateCareerLibrary(source) : source;
  if (request.operation === "get_job_search_context") {
    let career = current, libraryVersion = null;
    if (request.input.version_id && ["career_sources", "career_episodes", "career_qa"].includes(request.input.scope)) {
      const version = current.careerLibraryVersions.find(item => item.id === request.input.version_id);
      if (!version) throw projectStoreError("NOT_FOUND", "未找到知识库版本");
      const historical = await readCareerLibraryVersion(version, { scope: store.scope });
      career = historical.snapshot; libraryVersion = historical.version;
    }
    const result = buildJobSearchContext({ ...current, ...career, libraryVersion,
      careerLibraryVersions: current.careerLibraryVersions,
      project: { name: store.root.split(/[\\/]/).at(-1), root: store.root, hasSnapshot: Boolean(loaded.file) },
      projectStatePath: "job-hunt-panel.json", sessionId: request.sessionId || null,
      repositories: current.repos, workHistory: current.experiences,
      resumes: collectResumeRecords(current.resume, current.versions), mockSessions: current.mockInterviewSessions,
      jdInboxPath: "career-data/jd/inbox", providerCatalog: current.customProviders || [],
    }, jobSearchContextQuery(request.input));
    return { ok: true, result, revision: loaded.file?.revision ?? null };
  }
  let readonly = false;
  if (request.operation === "save_candidate_context") {
    const mode = candidateMode(request.input);
    readonly = ["library_version", "career_update"].includes(mode) && request.input[mode].action === "preview";
  }
  if (!readonly) {
    if (!Object.hasOwn(request, "expectedRevision")) throw projectStoreError("INVALID_INPUT", "写操作缺少expectedRevision，请先读取项目");
    ensureRevision(request.expectedRevision);
  }
  let prepared;
  if (request.operation === "save_candidate_context") prepared = await runCareerCandidateOperation(current, request.input,
    { scope: store.scope, projectKey: store.projectKey, sessionId: request.sessionId || "" });
  else prepared = { ...(request.operation === "save_resume_draft" ? prepareResumeDraft(current, request.input) : prepareResumeQaAnswer(current, request.input)), changed: true };
  // Reject oversized receipts before publishing the root, rather than saving
  // successfully and only then discovering the caller cannot receive the result.
  if (Buffer.byteLength(JSON.stringify(prepared.result)) > OUTPUT_LIMIT - 2048) throw projectStoreError("RESULT_TOO_LARGE", "结果过大，请使用分页读取");
  if (!prepared.changed) return { ok: true, result: prepared.result, revision: loaded.file?.revision ?? null };
  if (request.expectedRevision !== (loaded.file?.revision ?? null)) throw projectStoreError("REVISION_CONFLICT", "项目数据已变化，请重新读取后保存");
  const next = { ...prepared.state, schemaVersion: 2, updatedAt: new Date().toISOString() };
  const documents = prepareProjectSnapshotDocuments(next);
  const receipt = await writeProjectSnapshotDocuments(documents, { scope: store.scope, previousSnapshot: loaded.file });
  return { ok: true, result: { ...prepared.result, projectSaved: true }, revision: receipt.revision };
}

async function main(argv) {
  let operation, project = process.cwd(), inputFile, expectedRevision, sessionId;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (["--project", "--input-file", "--expected-revision", "--session-id"].includes(argument)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw projectStoreError("INVALID_INPUT", `${argument}缺少值`);
      if (argument === "--project") project = resolve(value);
      if (argument === "--input-file") inputFile = value;
      if (argument === "--expected-revision") expectedRevision = value === "null" ? null : value;
      if (argument === "--session-id") sessionId = value;
    } else if (!operation && !argument.startsWith("-")) operation = argument;
    else throw projectStoreError("INVALID_INPUT", `未知参数：${argument}`);
  }
  let request;
  if (operation === "ops") request = { operation: "ops" };
  else {
    let text;
    if (inputFile) text = createNodeProjectStore(project).read(inputFile).content;
    else {
      const chunks = []; let bytes = 0;
      for await (const chunk of process.stdin) {
        bytes += chunk.length;
        if (bytes > INPUT_LIMIT) throw projectStoreError("INVALID_INPUT", "CLI请求最多64 KiB；整批资料请通过career_update文件传入");
        chunks.push(chunk);
      }
      text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    }
    if (Buffer.byteLength(text) > INPUT_LIMIT) throw projectStoreError("INVALID_INPUT", "CLI请求最多64 KiB");
    const value = JSON.parse(text);
    request = operation ? { operation, input: value, ...(expectedRevision !== undefined ? { expectedRevision } : {}), ...(sessionId ? { sessionId } : {}) } : value;
  }
  return executeJobHuntRequest(request, { project });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then(result => { process.stdout.write(`${JSON.stringify(result)}\n`); }, error => {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: error.code || "INVALID_INPUT", message: error.message } })}\n`);
    process.exitCode = error.code === "REVISION_CONFLICT" ? 3 : error.code === "PROJECT_BUSY" ? 4 : 1;
  });
}
