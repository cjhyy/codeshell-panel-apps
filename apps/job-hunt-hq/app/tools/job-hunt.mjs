import { readFile, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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

const invalid = (message) => Object.assign(new Error(message), { code: "INVALID_ARGUMENT" });

// Validate against the installed Tool contract, including nested evidence objects.
// No second operation schema is maintained by the CLI.
export function validateToolInput(value, schema, path = "arguments") {
  const type = schema.type;
  const validType =
    type === "object"
      ? value !== null && typeof value === "object" && !Array.isArray(value)
      : type === "array"
        ? Array.isArray(value)
        : type === "integer"
          ? Number.isInteger(value)
          : type === "number"
            ? typeof value === "number" && Number.isFinite(value)
            : type === "null"
              ? value === null
              : typeof value === type;
  if (type && !validType) throw invalid(`${path} 必须是 ${type}`);
  if (schema.enum && !schema.enum.includes(value)) throw invalid(`${path} 不在允许值中`);
  if (Object.hasOwn(schema, "const") && value !== schema.const) throw invalid(`${path} 值不正确`);
  if (typeof value === "string") {
    if (
      (schema.minLength !== undefined && [...value].length < schema.minLength) ||
      (schema.maxLength !== undefined && [...value].length > schema.maxLength) ||
      (schema.pattern && !new RegExp(schema.pattern, "u").test(value))
    )
      throw invalid(`${path} 文本长度或格式不正确`);
  }
  if (
    typeof value === "number" &&
    ((schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum))
  )
    throw invalid(`${path} 超出允许范围`);
  if (Array.isArray(value)) {
    if (
      (schema.minItems !== undefined && value.length < schema.minItems) ||
      (schema.maxItems !== undefined && value.length > schema.maxItems)
    )
      throw invalid(`${path} 数量不正确`);
    if (schema.items)
      value.forEach((item, index) => validateToolInput(item, schema.items, `${path}[${index}]`));
  } else if (value && typeof value === "object") {
    for (const key of schema.required || [])
      if (!Object.hasOwn(value, key)) throw invalid(`${path}.${key} 为必填`);
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties || {}, key))
        validateToolInput(item, schema.properties[key], `${path}.${key}`);
      else if (schema.additionalProperties === false)
        throw invalid(`${path}.${key} 不是允许的参数`);
    }
  }
}

function parse(argv) {
  const [command, ...remaining] = argv;
  if (!["ops", "init", "run"].includes(command))
    throw invalid(
      "用法：job-hunt.mjs ops | init [--project dir] | run <op> --input-file req.json [--project dir] [--session id] [--trace id]",
    );
  const operation = command === "run" ? remaining.shift() : null;
  if (command === "run" && (!operation || operation.startsWith("--")))
    throw invalid("run 必须指定操作名");
  const options = {};
  const allowed =
    command === "run"
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
  if (command === "run" && !options["input-file"]) throw invalid("run 必须提供 --input-file");
  for (const key of ["session", "trace"])
    if (options[key]?.length > 100) throw invalid(`--${key} 最多 100 字符`);
  return { command, operation, options };
}

async function initialize(scope, now) {
  return scope.withWriteLock(async () => {
    let initialized = false;
    const createdFiles = [];
    try {
      await readProjectSnapshot(scope);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      // A missing shard is a damaged existing project, never permission to replace it.
      try {
        await scope.call("workspace.readText", { path: "job-hunt-panel.json" });
        throw Object.assign(new Error("现有快照不完整，请先修复"), { code: "INVALID_SNAPSHOT" });
      } catch (rootError) {
        if (rootError.code !== "ENOENT") throw rootError;
      }
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
  if (command === "ops")
    return {
      ok: true,
      result: tools.map(({ name, inputSchema, readOnly }) => ({ name, inputSchema, readOnly })),
    };
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
    now,
    uid: (prefix) => `${prefix}-${randomUUID()}`,
    source: "cli",
    sessionId: options.session || null,
    traceId: options.trace || args.trace_id || null,
    project: { ...(await scope.call("workspace.info")), hasSnapshot: true },
    projectStatePath: "job-hunt-panel.json",
  };
  const checkedOp = {
    ...op,
    run(snapshot, input, context) {
      try {
        return op.run(snapshot, input, context);
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
