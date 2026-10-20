import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createEditorAgentTools, compileEditorSteps } from "../src/editor/agent-tools.js";
import { compileAudioPlan } from "../src/editor/audio-plan.js";
import { createTrack } from "../src/editor/defaults.js";
import {
  createExportPresets,
  requiredExportEncoders,
  validateExportProfile,
} from "../src/editor/export-settings.js";
import { validateExportRange } from "../src/editor/export-range.js";
import { applyEditorOperations } from "../src/editor/operations.js";
import { reconcileEditorProduction } from "../src/editor/production-guard.js";
import { EditorSession } from "../src/editor/session.js";
import { ticksToFrame, ticksToSeconds } from "../src/editor/time.js";
import { sequenceDuration, validateEditorDocument } from "../src/editor/validation.js";
import {
  cliError,
  createProjectStore,
  DOCUMENT_BYTES,
  OUTPUT_BYTES,
  PROJECT_FILE,
  readJsonFile,
  REQUEST_BYTES,
} from "./project-store.js";

const plain = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function fields(value: unknown, allowed: string[]): Record<string, any> {
  if (!plain(value) || Object.keys(value).some((key) => !allowed.includes(key)))
    throw cliError("INVALID_INPUT", "请求须为仅包含当前操作字段的 JSON 对象");
  return value;
}
function expected(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value))
    throw cliError("INVALID_INPUT", "写入需要 inspect 返回的 expectedRevision");
  return value;
}
function bounded<T>(value: T): T {
  if (Buffer.byteLength(JSON.stringify(value)) > OUTPUT_BYTES)
    throw cliError("OUTPUT_LIMIT", "CLI 结果超过 64 KiB；请使用 inspect 分页读取");
  return value;
}
const revisionSchema = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" };
const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const stringSchema = { type: "string", minLength: 1 };
const commands = [
  {
    name: "init",
    readOnly: false,
    inputSchema: objectSchema({
      name: stringSchema,
      width: { type: "integer" },
      height: { type: "integer" },
      frameRate: objectSchema(
        { numerator: { type: "integer" }, denominator: { type: "integer" } },
        ["numerator", "denominator"],
      ),
    }),
    description: "Create a missing, empty schema-2 CLI project; preserve an existing project.",
  },
  {
    name: "inspect",
    readOnly: true,
    inputSchema: objectSchema({
      expectedRevision: revisionSchema,
      view: { enum: ["document", "defaults"] },
      path: { type: "string" },
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      format: { enum: ["tree", "json"] },
    }),
    description: "Bounded editor-domain JSON pointer pages; retain expectedRevision across pages.",
  },
  {
    name: "validate",
    readOnly: true,
    inputSchema: objectSchema({ documentFile: stringSchema }),
    description: "Validate the saved project, or an explicitly supplied schema-2 JSON file.",
  },
  {
    name: "edit",
    readOnly: false,
    inputSchema: objectSchema(
      {
        expectedRevision: revisionSchema,
        label: { type: "string", minLength: 1, maxLength: 200 },
        steps: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            required: ["kind"],
            properties: {
              kind: {
                enum: [
                  "operations",
                  "sequence",
                  "captions",
                  "multicam",
                  "marker",
                  "split",
                  "trim",
                  "timing",
                  "move",
                  "remove",
                  "transition",
                  "arrange",
                  "group",
                  "ungroup",
                  "duplicate",
                ],
              },
            },
            description: "The editor-v2 planner step contract; each kind rejects unknown fields.",
          },
        },
      },
      ["expectedRevision", "label", "steps"],
    ),
    description:
      "Compile the same editor-v2 steps and atomically save one transaction. apply is an alias.",
  },
  {
    name: "plan",
    readOnly: true,
    inputSchema: objectSchema({
      expectedRevision: revisionSchema,
      sequenceId: stringSchema,
      profileId: stringSchema,
      profile: {
        type: "object",
        description: "A complete editor-v2 ExportProfile, validated by the shared export domain.",
      },
      range: objectSchema(
        { start: { type: "integer", minimum: 0 }, duration: { type: "integer", minimum: 1 } },
        ["start", "duration"],
      ),
    }),
    description:
      "Validate export settings, rational frame count, encoder names and the audio-plan summary. Planning produces no media.",
  },
  {
    name: "import",
    readOnly: false,
    inputSchema: objectSchema({ expectedRevision: revisionSchema, documentFile: stringSchema }, [
      "expectedRevision",
      "documentFile",
    ]),
    description:
      "Replace the independent CLI project with explicitly supplied schema-2 JSON after CAS; source media is not copied.",
  },
  {
    name: "export",
    readOnly: false,
    inputSchema: objectSchema({ expectedRevision: revisionSchema, output: stringSchema }, [
      "output",
    ]),
    description:
      "Create a schema-2 project JSON file below this project without overwriting files; this is not video rendering or a media-inclusive .mimiproject bundle.",
  },
];

function summary(document: ReturnType<typeof validateEditorDocument>) {
  return {
    id: document.id,
    name: document.name,
    documentRevision: document.revision,
    schemaVersion: document.schemaVersion,
    timebase: document.timebase,
    activeSequenceId: document.activeSequenceId,
    assetCount: document.assets.length,
    sequenceCount: document.sequences.length,
  };
}
function initialDocument(input: Record<string, any>) {
  const sequenceId = `sequence-${randomUUID()}`;
  return validateEditorDocument({
    schemaVersion: 2,
    timebase: 240000,
    id: `project-${randomUUID()}`,
    name: input.name ?? "视频工程",
    revision: 0,
    assets: [],
    activeSequenceId: sequenceId,
    sequences: [
      {
        id: sequenceId,
        name: "主序列",
        width: input.width ?? 1920,
        height: input.height ?? 1080,
        frameRate: input.frameRate ?? { numerator: 30, denominator: 1 },
        background: "#000000",
        timelineMode: "free",
        tracks: [
          createTrack(`track-${randomUUID()}`, "video"),
          createTrack(`track-${randomUUID()}`, "audio"),
          createTrack(`track-${randomUUID()}`, "text"),
        ],
        clips: [],
        transitions: [],
        markers: [],
      },
    ],
    exportProfiles: createExportPresets(),
  });
}
function parse(argv: string[]) {
  const [raw, ...remaining] = argv,
    command = raw === "apply" ? "edit" : raw;
  if (command !== "ops" && !commands.some((item) => item.name === command))
    throw cliError(
      "INVALID_ARGUMENT",
      "用法：video-studio.mjs ops | init|inspect|validate|edit|apply|plan|import|export --project <dir> [--input-file <json>]",
    );
  const options: Record<string, string> = {};
  while (remaining.length) {
    const flag = remaining.shift()!,
      value = remaining.shift();
    if (
      !["--project", "--input-file"].includes(flag) ||
      options[flag] ||
      !value ||
      value.startsWith("--")
    )
      throw cliError("INVALID_ARGUMENT", `参数无效：${flag}`);
    options[flag] = value;
  }
  if (command === "ops" && Object.keys(options).length)
    throw cliError("INVALID_ARGUMENT", "ops 不接受项目或请求文件参数");
  if (["edit", "import", "export"].includes(command) && !options["--input-file"])
    throw cliError("INVALID_ARGUMENT", `${command} 需要 --input-file`);
  return { command, options };
}

export async function runProjectCli(argv: string[], cwd = process.cwd()): Promise<unknown> {
  const { command, options } = parse(argv);
  if (command === "ops")
    return {
      ok: true,
      result: {
        format: "codeshell.video-studio.cli",
        schemaVersion: 1,
        commands,
        projectFile: PROJECT_FILE,
        node: ">=20.10",
        limits: {
          requestBytes: REQUEST_BYTES,
          documentBytes: DOCUMENT_BYTES,
          outputBytes: OUTPUT_BYTES,
        },
        persistence:
          "Independent CLI file; explicit schema-2 import/export exchanges data with the panel. No Host storage, task IDs or resource grants are inferred.",
        time: "240000 ticks/second; frameRate is {numerator,denominator}.",
        editExample: {
          expectedRevision: "<inspect revision>",
          label: "重命名",
          steps: [
            { kind: "operations", operations: [{ type: "project.rename", name: "我的视频" }] },
          ],
        },
      },
    };
  const raw = options["--input-file"]
    ? (await readJsonFile(resolve(cwd, options["--input-file"]), REQUEST_BYTES)).data
    : {};
  const allowed: Record<string, string[]> = {
    init: ["name", "width", "height", "frameRate"],
    inspect: ["expectedRevision", "view", "path", "offset", "limit", "format"],
    validate: ["documentFile"],
    edit: ["expectedRevision", "label", "steps"],
    plan: ["expectedRevision", "sequenceId", "profileId", "profile", "range"],
    import: ["expectedRevision", "documentFile"],
    export: ["expectedRevision", "output"],
  };
  const input = fields(raw, allowed[command]);
  if (command === "validate" && input.documentFile !== undefined) {
    if (typeof input.documentFile !== "string" || !input.documentFile)
      throw cliError("INVALID_INPUT", "documentFile 须为明确指定的 JSON 文件路径");
    const document = validateEditorDocument(
      (await readJsonFile(resolve(cwd, input.documentFile), DOCUMENT_BYTES)).data,
    );
    return { ok: true, result: { valid: true, ...summary(document), mediaChecked: false } };
  }
  const store = await createProjectStore(resolve(cwd, options["--project"] ?? "."));
  const result = (value: unknown) =>
    bounded({ ok: true, project: store.root, projectFile: PROJECT_FILE, result: value });
  if (command === "init")
    return store.withLock(async () => {
      const existing = await store.read();
      if (existing)
        return result({
          initialized: false,
          revision: existing.revision,
          ...summary(validateEditorDocument(existing.data)),
        });
      const document = initialDocument(input),
        receipt = { initialized: true, ...summary(document) };
      bounded(receipt);
      const saved = await store.write(document, null);
      return result({ ...receipt, revision: saved.revision });
    });
  const execute = async () => {
    const stored = await store.read();
    if (!stored)
      throw cliError("PROJECT_NOT_INITIALIZED", `当前项目缺少 ${PROJECT_FILE}，请先执行 init`);
    const document = validateEditorDocument(stored.data);
    if (
      input.expectedRevision !== undefined &&
      expected(input.expectedRevision) !== stored.revision
    )
      throw cliError("REVISION_CONFLICT", "工程已变化，请重新读取并重新规划");
    if (command === "inspect") {
      const { expectedRevision: _, ...request } = input;
      const session = await EditorSession.open({
        read: async () => ({ data: document, revision: 1 }),
        write: async () => {
          throw new Error("只读");
        },
        backupLegacy: async () => {
          throw new Error("只读");
        },
      });
      try {
        const tools = createEditorAgentTools({
          session: () => session,
          authorize: () => {
            throw new Error("只读");
          },
        });
        const read = tools.read_editor_project(request);
        return result({ revision: stored.revision, ...summary(document), page: read.page });
      } finally {
        await session.close();
      }
    }
    if (command === "validate")
      return result({
        valid: true,
        revision: stored.revision,
        ...summary(document),
        mediaChecked: false,
      });
    if (command === "edit") {
      expected(input.expectedRevision);
      if (typeof input.label !== "string" || !input.label.trim() || input.label.length > 200)
        throw cliError("INVALID_INPUT", "编辑说明须为 1 至 200 个字符");
      const operations = compileEditorSteps(
          document,
          input.steps,
          (kind) => `${kind}-${randomUUID()}`,
        ),
        draft = applyEditorOperations(document, operations, document.revision),
        annotations = reconcileEditorProduction(document, draft),
        after = annotations.length
          ? applyEditorOperations(document, [...operations, ...annotations], document.revision)
          : draft;
      const receipt = {
        label: input.label,
        operationCount: operations.length,
        productionInvalidated: annotations.length > 0,
        ...summary(after),
      };
      bounded(receipt);
      const saved = await store.write(after, stored.revision);
      return result({ ...receipt, revision: saved.revision });
    }
    if (command === "import") {
      expected(input.expectedRevision);
      if (typeof input.documentFile !== "string" || !input.documentFile)
        throw cliError("INVALID_INPUT", "documentFile 须为明确指定的 JSON 文件路径");
      const imported = validateEditorDocument(
          (await readJsonFile(resolve(cwd, input.documentFile), DOCUMENT_BYTES)).data,
        ),
        receipt = { imported: true, ...summary(imported), mediaCopied: false };
      bounded(receipt);
      const saved = await store.write(imported, stored.revision);
      return result({ ...receipt, revision: saved.revision });
    }
    if (command === "export") {
      if (typeof input.output !== "string")
        throw cliError("INVALID_INPUT", "output 须为项目内的相对 JSON 路径");
      const receipt = {
        exported: true,
        mediaIncluded: false,
        ...summary(document),
        revision: stored.revision,
      };
      bounded({ ...receipt, output: input.output });
      const saved = await store.export(input.output, document);
      return result({
        ...receipt,
        output: saved.path,
        outputRevision: saved.revision,
        bytes: saved.bytes,
      });
    }
    if (input.profile !== undefined && input.profileId !== undefined)
      throw cliError("INVALID_INPUT", "profile 与 profileId 只能提供一个");
    const sequenceId = input.sequenceId ?? document.activeSequenceId,
      sequence = document.sequences.find((item) => item.id === sequenceId);
    if (!sequence) throw cliError("INVALID_INPUT", "导出序列不存在");
    const profileValue =
      input.profile ??
      (input.profileId === undefined
        ? document.exportProfiles[0]
        : document.exportProfiles.find((item) => item.id === input.profileId));
    if (!profileValue)
      throw cliError("INVALID_INPUT", "导出配置不存在，请提供完整 profile 或当前 profileId");
    const profile = validateExportProfile(profileValue),
      fullDuration = sequenceDuration(sequence),
      range = validateExportRange(
        input.range ?? { start: 0, duration: fullDuration },
        fullDuration,
      ),
      audio = compileAudioPlan(document, sequence.id),
      frameCount = ticksToFrame(range.duration, profile.frameRate, "ceil");
    return result({
      planned: true,
      rendered: false,
      revision: stored.revision,
      sequenceId,
      profile,
      range,
      frameCount,
      durationSeconds: ticksToSeconds(range.duration),
      encodedDurationSeconds:
        (frameCount * profile.frameRate.denominator) / profile.frameRate.numerator,
      requiredEncoders: requiredExportEncoders(profile),
      dependenciesChecked: false,
      mediaChecked: false,
      audio: {
        sampleRate: audio.sampleRate,
        channels: audio.channels,
        requestedRangeSampleCount:
          Math.ceil((range.start + range.duration) / 5) - Math.ceil(range.start / 5),
        fullSequenceSampleCount: audio.sampleCount,
        fullSequenceLaneCount: audio.lanes.length,
        fullSequenceDuckingCount: audio.ducking.length,
      },
      next: "实际媒体导出使用已授权面板流程；CLI export 只导出工程 JSON。",
    });
  };
  return ["edit", "import", "export"].includes(command) ? store.withLock(execute) : execute();
}

try {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 10))
    throw cliError("NODE_VERSION", "Video Studio CLI 需要 Node.js 20.10 或更新版本");
  process.stdout.write(`${JSON.stringify(bounded(await runProjectCli(process.argv.slice(2))))}\n`);
} catch (error) {
  const rawCode = (error as { code?: unknown })?.code,
    code = typeof rawCode === "string" ? rawCode.slice(0, 100) : "OPERATION_FAILED";
  process.stdout.write(
    `${JSON.stringify({ ok: false, error: { code, message: error instanceof Error ? error.message.slice(0, 1000) : "CLI 操作未完成" } })}\n`,
  );
  process.exitCode = ["INVALID_INPUT", "INVALID_ARGUMENT", "INPUT_LIMIT"].includes(code)
    ? 2
    : code === "REVISION_CONFLICT"
      ? 3
      : code === "PROJECT_BUSY"
        ? 4
        : 1;
}
