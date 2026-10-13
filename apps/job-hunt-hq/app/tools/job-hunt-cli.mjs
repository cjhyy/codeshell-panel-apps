#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createNodeProjectStore, projectStoreError } from "../node-project-store.mjs";
import { jobHuntOperations } from "../ops/index.mjs";
import { applyOp } from "../snapshot-codec.mjs";
import { projectSnapshotShardDescriptors, hydrateProjectSnapshotDocuments } from "../snapshot-sharding-model.mjs";
import { validateToolInput } from "./job-hunt.mjs";

const MANIFEST = JSON.parse(readFileSync(new URL("../../.codeshell-panel/panel.json", import.meta.url), "utf8"));
const SUPPORTED = ["get_job_search_context", "save_candidate_context", "save_resume_draft", "save_resume_qa_answer"];
const INPUT_LIMIT = 64 * 1024;
const OUTPUT_LIMIT = 512 * 1024;
const plain = value => value && typeof value === "object" && !Array.isArray(value);
function fields(value, allowed, label) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) throw projectStoreError("INVALID_INPUT", `${label}含未知字段或不是JSON对象`);
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
    const result = await store.write({ path: "job-hunt-panel.json", content: staged.content,
      ...(Object.hasOwn(request.input, "expectedRevision") ? { expectedRevision: request.input.expectedRevision } : {}),
      ...(Object.hasOwn(request.input, "expectedModifiedAt") ? { expectedModifiedAt: request.input.expectedModifiedAt } : {}) });
    return { ok: true, result, revision: result.revision };
  }
  const tool = MANIFEST.agent.tools.find(tool => tool.name === request.operation && SUPPORTED.includes(tool.name));
  if (!tool) throw projectStoreError("UNSUPPORTED", `不支持的operation：${request.operation}`);
  validateToolInput(request.input, tool.inputSchema);
  const op = jobHuntOperations[request.operation];
  const preview = request.operation === "save_candidate_context" &&
    ["library_version", "career_update"].some(mode => request.input[mode]?.action === "preview");
  if (op.mutates && !preview) {
    if (!Object.hasOwn(request, "expectedRevision")) throw projectStoreError("INVALID_INPUT", "写操作缺少expectedRevision，请先读取项目");
    ensureRevision(request.expectedRevision);
  }
  let previousSnapshot = null;
  const ctx = {
    now: new Date().toISOString(), uid: prefix => `${prefix}-${randomUUID()}`,
    careerVersionId: `career-version-${randomUUID()}`,
    source: "cli", sessionId: request.sessionId || null, traceId: request.input.trace_id || null,
    project: { name: store.root.split(/[\\/]/).at(-1), root: store.root, cwd: store.root, hasSnapshot: false },
    projectStatePath: "job-hunt-panel.json", projectKey: store.root,
  };
  const scope = { ...store.scope, async call(method, params) {
    const result = await store.scope.call(method, params);
    if (method === "workspace.readText" && params.path === "job-hunt-panel.json") {
      previousSnapshot = result;
      ctx.project.hasSnapshot = true;
    }
    return result;
  } };
  ctx.scope = scope;
  const checkedOp = { ...op, async run(snapshot, input, context) {
    const prepared = await op.run(snapshot, input, context);
    // Bound the receipt before applyOp publishes a mutation. Idempotent replay
    // and previews keep the exact freshly read root revision without a write.
    if (Buffer.byteLength(JSON.stringify(prepared.result)) > OUTPUT_LIMIT - 2048)
      throw projectStoreError("RESULT_TOO_LARGE", "结果过大，请使用分页读取");
    if (op.mutates && prepared.changed !== false && request.expectedRevision !== (previousSnapshot?.revision ?? null))
      throw projectStoreError("REVISION_CONFLICT", "项目数据已变化，请重新读取后保存");
    return prepared;
  } };
  const { result, writeResult } = await applyOp(scope, checkedOp, request.input, ctx,
    { maxConflictRetries: 0, allowMissingSnapshot: true });
  return { ok: true, result, revision: writeResult?.revision ?? previousSnapshot?.revision ?? null };
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
    // An untyped failure may follow publication (for example lock cleanup).
    // Never label it as a definite prepublication input rejection.
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: error.code || "OPERATION_FAILED", message: error.message } })}\n`);
    process.exitCode = error.code === "REVISION_CONFLICT" ? 3 : error.code === "PROJECT_BUSY" ? 4 : 1;
  });
}
