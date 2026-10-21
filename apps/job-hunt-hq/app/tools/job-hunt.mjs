import { observe, observationInputSchema } from "./observation-runner.mjs";
import { validatePanelToolInput } from "../tool-input-validation.mjs";
import { readFile, realpath } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { jobHuntOperations } from "../ops/index.mjs";
import {
  applyOp,
  emptyProjectSnapshot,
  projectSnapshotPayload,
  readProjectSnapshot,
} from "../snapshot-codec.mjs";
import { prepareProjectSnapshotDocuments } from "../snapshot-sharding-model.mjs";
import { writeProjectSnapshotDocuments } from "../snapshot-storage.mjs";
import { PROJECT_CANDIDATE_TEMPLATE_PATHS } from "../project-bootstrap.mjs";
import { createNodeWorkspaceScope, findJobHuntProject } from "./node-workspace-scope.mjs";

const observationTaskSchema = { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 50 } } };
const observationSchema = observationInputSchema(observationTaskSchema);

const invalid = (message) => Object.assign(new Error(message), { code: "INVALID_ARGUMENT" });

// Panel write operations reuse the manifest contract; CLI-only read operations declare their schema in the registry.
export function validateToolInput(value, schema, path = "arguments") {
  try { return validatePanelToolInput(schema, value, path); }
  catch (error) { throw invalid(error.message); }
}

function parse(argv) {
  const [command, ...remaining] = argv;
  if (!["ops", "init", "run", "observe"].includes(command))
    throw invalid(
      "用法：job-hunt.mjs ops | init [--project dir] | run <op> --input-file req.json [--project dir] [--session id] [--trace id]",
    );
  const operation = command === "run" ? remaining.shift() : null;
  if (command === "run" && (!operation || operation.startsWith("--")))
    throw invalid("run 必须指定操作名");
  const options = {};
  const allowed =
    command === "observe" ? ["project", "input-file"] : command === "run"
      ? ["project", "input-file", "session", "trace"]
      : command === "init"
        ? ["project"]
        : [];
  while (remaining.length) {
    const flag = remaining.shift();
    const name = flag?.slice(2);
    const value = remaining.shift();
    if (
      !flag?.startsWith("--") ||
      !allowed.includes(name) ||
      Object.hasOwn(options, name) ||
      !value ||
      value.startsWith("--")
    )
      throw invalid(`无效参数：${flag || ""}`);
    options[name] = value;
  }
  if (["run", "observe"].includes(command) && !options["input-file"]) throw invalid("run/observe 必须提供 --input-file");
  for (const key of ["session", "trace"])
    if (options[key]?.length > 100) throw invalid(`--${key} 最多 100 字符`);
  return { command, operation, options };
}

async function initialize(scope, now) {
  return scope.withWriteLock(async () => {
    let initialized = false;
    const createdFiles = [];
    const { previousSnapshot } = await readProjectSnapshot(scope, { allowMissingRoot: true });
    if (!previousSnapshot) {
      const payload = projectSnapshotPayload(emptyProjectSnapshot(), { now });
      await writeProjectSnapshotDocuments(prepareProjectSnapshotDocuments(payload), { scope });
      initialized = true;
      createdFiles.push("job-hunt-panel.json");
    }
    const templates = {
      "CODESHELL.md":
        "# Job Hunt HQ\n\n求职资料保存在 career-data/，结构化结果保存在 job-hunt-panel.json。\n只记录本人提供或可核验的事实；目标、职责、联系方式和指标不从项目介绍推测。\n先建立方向级 Base Resume，再派生 JD Variant；个人资料不提交到公共仓库。\n",
      ...Object.fromEntries(
        PROJECT_CANDIDATE_TEMPLATE_PATHS.map((path) => [
          path,
          path.endsWith("README.md")
            ? "# 原始 JD\n\nTODO：将本人收集的原始岗位描述放在此目录。\n"
            : `# ${path.split("/").at(-1).replace(/\.md$/, "")}\n\nTODO：填写本人提供或可核验的资料；不要把占位文字当成事实。\n`,
        ]),
      ),
    };
    for (const [path, content] of Object.entries(templates)) {
      try {
        await scope.call("workspace.readText", { path });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await scope.call("workspace.writeText", { path, content, expectedModifiedAt: null });
        createdFiles.push(path);
      }
    }
    return {
      initialized,
      project: scope.root,
      projectStatePath: "job-hunt-panel.json",
      createdFiles,
    };
  });
}

export async function main(argv, { cwd = process.cwd() } = {}) {
  const { command, operation, options } = parse(argv);
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const manifest = JSON.parse(
    await readFile(join(packageRoot, ".codeshell-panel/panel.json"), "utf8"),
  );
  if (manifest.id !== "job-hunt-hq") throw new Error("bundled-job-hunt-cli-not-found");
  const tools = manifest.agent.tools.filter((tool) => Object.hasOwn(jobHuntOperations, tool.name));
  for (const [name, op] of Object.entries(jobHuntOperations))
    if (op.inputSchema && !tools.some(tool => tool.name === name)) tools.push({ name, inputSchema: op.inputSchema, readOnly: !op.mutates });
  if (command === "ops")
    return {
      ok: true,
      observation: { command: "observe", inputSchema: observationSchema, note: "单轮执行并退出；只重读已有 JD，无自动抓取或 OS 调度。" },
      result: tools.map(({ name, inputSchema, readOnly }) => ({ name, inputSchema, readOnly })),
    };
  if (command === "observe") {
    let input;
    const raw = await readFile(resolve(cwd, options["input-file"]), "utf8");
    if (Buffer.byteLength(raw) > 65536) throw invalid("观察输入超过64KiB");
    try { input = JSON.parse(raw); } catch { throw invalid("input-file 不是有效 JSON"); }
    validateToolInput(input, observationSchema);
    const root = options.project ? resolve(cwd, options.project) : cwd;
    const entry = fileURLToPath(import.meta.url);
    const hash = createHash("sha256");
    for (const path of [import.meta.url, new URL("./observation-runner.mjs", import.meta.url), new URL("../job-research-digest.mjs", import.meta.url), new URL("../ops/jobs.mjs", import.meta.url)]) hash.update(await readFile(new URL(path)));
    const result = await observe(input, { project: root, app: manifest.id,
      package: { version: manifest.version, toolPath: entry, codeSha256: hash.digest("hex") },
      validateTask: task => validateToolInput(task, observationTaskSchema),
      execute: async task => {
        const scope = await createNodeWorkspaceScope(root);
        const { snapshot } = await readProjectSnapshot(scope);
        const { result } = await jobHuntOperations.get_job_research_digest.run(snapshot, task, { now: new Date().toISOString() });
        return { kind: "existing-jd-digest", generatedAt: result.generatedAt, counts: result.counts, markdown: result.markdown, note: "没有自动抓取或网络核验。" };
      },
    });
    return { ok: true, result };
  }
  let tool, op, args;
  if (command === "run") {
    tool = tools.find((item) => item.name === operation);
    if (!tool) throw invalid(`此版本不支持操作：${operation}`);
    op = jobHuntOperations[operation];
    try {
      args = JSON.parse(await readFile(resolve(cwd, options["input-file"]), "utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) throw invalid("input-file 不是有效 JSON");
      throw error;
    }
    validateToolInput(args, tool.inputSchema);
    if (args.trace_id && options.trace && args.trace_id !== options.trace)
      throw invalid("--trace 与 trace_id 不一致");
  }
  const root = options.project
    ? resolve(cwd, options.project)
    : command === "init"
      ? cwd
      : await findJobHuntProject(cwd);
  const scope = await createNodeWorkspaceScope(root);
  const now = new Date().toISOString();
  if (command === "init") return { ok: true, result: await initialize(scope, now) };
  const ctx = {
    now, scope, projectKey: scope.root,
    // Replaying a root conflict must reuse the same immutable artifact identity.
    ...(args.library_version?.action === "save" && !args.library_version.id
      ? { careerVersionId: `career-version-${randomUUID()}` } : {}),
    uid: (prefix) => `${prefix}-${randomUUID()}`,
    source: "cli",
    sessionId: options.session || null,
    traceId: options.trace || args.trace_id || null,
    project: { ...(await scope.call("workspace.info")), hasSnapshot: true },
    projectStatePath: "job-hunt-panel.json",
  };
  const checkedOp = {
    ...op,
    async run(snapshot, input, context) {
      try {
        return await op.run(snapshot, input, context);
      } catch (error) {
        if (!error.code) error.code = "INVALID_ARGUMENT";
        throw error;
      }
    },
  };
  const { result } = await applyOp(scope, checkedOp, args, ctx);
  return { ok: true, result };
}

async function isMainEntry() {
  if (!process.argv[1]) return false;
  try {
    const [entryPath, modulePath] = await Promise.all([
      realpath(process.argv[1]),
      realpath(fileURLToPath(import.meta.url)),
    ]);
    return entryPath === modulePath;
  } catch {
    return false;
  }
}

if (await isMainEntry()) {
  try {
    process.stdout.write(`${JSON.stringify(await main(process.argv.slice(2)))}\n`);
  } catch (error) {
    const code = error.code || "OPERATION_FAILED";
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: { code, message: error.message || String(error) } })}\n`,
    );
    process.exitCode = code === "INVALID_ARGUMENT" ? 2 : code === "REVISION_CONFLICT" ? 3 : 1;
  }
}
