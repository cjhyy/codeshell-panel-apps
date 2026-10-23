import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { source as rendererSource, sha256 as rendererSha } from "panel-browser:editor-renderer";
import {
  defaultAudioMix,
  defaultColorAdjustment,
  defaultTransform,
} from "../src/editor/defaults.js";
import { validateExportProfile } from "../src/editor/export-settings.js";
import { validateExportRange } from "../src/editor/export-range.js";
import { applyEditorOperations, type EditorOperation } from "../src/editor/operations.js";
import { findFreeTrack, planAppendPlacement } from "../src/editor/placement.js";
import { reconcileEditorProduction } from "../src/editor/production-guard.js";
import { editorTaskDocument } from "../src/editor/task-bridge.js";
import {
  constantTimeMap,
  freezeTimeMap,
  secondsToTicks,
  ticksToSeconds,
  type Tick,
} from "../src/editor/time.js";
import type { EditorAsset, EditorDocument, MediaClip } from "../src/editor/types.js";
import { sequenceDuration, validateEditorDocument } from "../src/editor/validation.js";
import type { EditorOriginals } from "./editor-runtime/files.js";
import { inspectEditorSource } from "./editor-runtime/inspect.js";
import { runEditorRequest } from "./editor-runtime/runtime.js";
import { findExecutable } from "./media/media-executables.js";
import { createMediaJobProcessors } from "./media/media-processors.js";
import { runMediaRequest } from "./media/media-runtime.js";
import { runMediaProcess } from "./process-runner.js";
import { cliError, type createProjectStore } from "./project-store.js";

type Store = Awaited<ReturnType<typeof createProjectStore>>;
type Progress = (stage: string, fraction?: number) => void;
export interface MediaCommandContext {
  store: Store;
  cwd: string;
  signal: AbortSignal;
  progress: Progress;
}

const plain = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const seconds = (tick: Tick) => Math.round(ticksToSeconds(tick) * 1000) / 1000;
const text = (value: unknown, label: string, max = 512) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw cliError("INVALID_INPUT", `${label}须为 1 至 ${max} 个字符`);
  return value;
};
const finiteSeconds = (value: unknown, label: string, min = 0, max = 24 * 3600) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw cliError("INVALID_INPUT", `${label}须为 ${min} 至 ${max} 之间的秒数`);
  return value;
};
const revisionOf = (value: unknown) => {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value))
    throw cliError("INVALID_INPUT", "写入需要 inspect 返回的 expectedRevision");
  return value;
};

/** Device-wide state shared by every CLI project: installed voices and render caches. */
async function cliHome(): Promise<string> {
  const configured = process.env.VIDEO_STUDIO_CLI_HOME;
  if (configured !== undefined && !isAbsolute(configured))
    throw cliError("INVALID_ARGUMENT", "VIDEO_STUDIO_CLI_HOME 须为绝对路径");
  const home = configured ?? join(homedir(), ".cache", "video-studio-cli");
  await mkdir(home, { recursive: true, mode: 0o700 });
  const info = await lstat(home);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw cliError("UNSAFE_PATH", "CLI 运行目录须为真实目录");
  return realpath(home);
}
async function privateDirectory(path: string): Promise<string> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw cliError("UNSAFE_PATH", "CLI 运行目录无效");
  return realpath(path);
}
/** One temporary job directory, always removed; results are copied into the project first. */
async function withJob<T>(home: string, work: (jobDir: string, jobId: string) => Promise<T>) {
  const jobs = await privateDirectory(join(home, "jobs"));
  const jobDir = await mkdtemp(join(jobs, "job-"));
  try {
    return await work(jobDir, `cli-${randomUUID()}`);
  } finally {
    await rm(jobDir, { recursive: true, force: true });
  }
}
async function tool(name: "ffmpeg" | "ffprobe" | "whisper") {
  const path = await findExecutable(name);
  if (!path)
    throw cliError(
      "MISSING_DEPENDENCY",
      name === "whisper"
        ? "需要本机 Whisper（pip install openai-whisper）才能转写"
        : `需要本机 ${name}（例如 brew install ffmpeg）`,
    );
  return path;
}

// ---- Registered local media ----

interface MediaEntry {
  path: string;
  name: string;
  bytes: number;
  sha256: string;
  mtimeMs: number;
}
type MediaRegistry = Map<string, MediaEntry>;
const MEDIA_FORMAT = "codeshell.video-studio.cli-media";

async function readRegistry(store: Store): Promise<MediaRegistry> {
  const raw = await store.readMedia();
  const registry: MediaRegistry = new Map();
  if (raw === undefined) return registry;
  if (!plain(raw) || raw.format !== MEDIA_FORMAT || raw.version !== 1 || !plain(raw.media))
    throw cliError("INVALID_PROJECT", "素材登记文件格式无效");
  for (const [id, entry] of Object.entries(raw.media)) {
    if (
      !/^external-[a-f0-9]{64}$/.test(id) ||
      !plain(entry) ||
      typeof entry.path !== "string" ||
      typeof entry.name !== "string" ||
      !Number.isSafeInteger(entry.bytes) ||
      typeof entry.sha256 !== "string" ||
      id !== `external-${entry.sha256}` ||
      typeof entry.mtimeMs !== "number"
    )
      throw cliError("INVALID_PROJECT", `素材登记条目无效：${id}`);
    registry.set(id, entry as MediaEntry);
  }
  return registry;
}
function registryData(registry: MediaRegistry) {
  return {
    format: MEDIA_FORMAT,
    version: 1,
    media: Object.fromEntries([...registry].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
}
/** Project media is stored relative, so the project can move; outside files stay absolute. */
function storedPath(root: string, path: string) {
  const inside = relative(root, path);
  return inside && !inside.startsWith(`..${sep}`) && inside !== ".." && !isAbsolute(inside)
    ? inside.split(sep).join("/")
    : path;
}
/** The registered file as it is now; changed bytes are refused, not silently re-read. */
async function locate(root: string, id: string, entry: MediaEntry, signal: AbortSignal) {
  const path = isAbsolute(entry.path) ? entry.path : join(root, ...entry.path.split("/"));
  let real: string, info;
  try {
    real = await realpath(path);
    info = await stat(real);
  } catch {
    throw cliError("SOURCE_MISSING", `素材「${entry.name}」找不到了，请重新 add-media`);
  }
  if (!info.isFile()) throw cliError("SOURCE_MISSING", `素材「${entry.name}」不是文件`);
  if (info.size !== entry.bytes)
    throw cliError("SOURCE_CHANGED", `素材「${entry.name}」已变化，请重新 add-media`);
  if (info.mtimeMs !== entry.mtimeMs) {
    // Touched but maybe unchanged: only the content decides.
    const { sha256 } = await hashFile(real, signal);
    if (`external-${sha256}` !== id)
      throw cliError("SOURCE_CHANGED", `素材「${entry.name}」已变化，请重新 add-media`);
  }
  return { path: real, bytes: info.size };
}
async function hashFile(path: string, signal: AbortSignal) {
  const { createReadStream } = await import("node:fs");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    if (signal.aborted) throw cliError("CANCELLED", "已取消");
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex") };
}

// ---- add-media ----

interface Inspected {
  path: string;
  name: string;
  entry: MediaEntry;
  resourceId: string;
  asset: Omit<EditorAsset, "id">;
}
async function inspectFile(
  path: string,
  name: string | undefined,
  root: string,
  signal: AbortSignal,
): Promise<Inspected> {
  let real: string, info;
  try {
    real = await realpath(path);
    info = await stat(real);
  } catch {
    throw cliError("INVALID_INPUT", `找不到素材文件：${basename(path)}`);
  }
  if (!info.isFile()) throw cliError("INVALID_INPUT", `不是普通文件：${basename(path)}`);
  const inspected = await inspectEditorSource(
    real,
    `external-${"0".repeat(64)}`,
    await tool("ffprobe"),
    signal,
  );
  const resourceId = `external-${inspected.sha256}`,
    label = name?.trim() || basename(real);
  return {
    path: real,
    name: label,
    resourceId,
    entry: {
      path: storedPath(root, real),
      name: label,
      bytes: inspected.bytes,
      sha256: inspected.sha256,
      mtimeMs: info.mtimeMs,
    },
    asset: {
      name: label,
      kind: inspected.kind,
      duration: inspected.duration,
      ...(inspected.width === undefined ? {} : { width: inspected.width, height: inspected.height }),
      resourceId,
      fingerprint: inspected.sha256,
      metadata: {
        mimeType: inspected.mimeType,
        size: inspected.bytes,
        bytes: inspected.bytes,
        lastModified: Math.max(0, Math.floor(info.mtimeMs)),
        editorInspection: structuredClone(inspected.inspection) as any,
      },
    },
  };
}
type Placement = { mode: "append" } | { mode: "none" } | { mode: "at"; start: Tick; trackId?: string };

/** Add inspected files as assets (reusing an asset of the same bytes) and place their clips. */
async function addInspected(
  context: MediaCommandContext,
  expected: string,
  files: Inspected[],
  placement: Placement,
  imageDuration: Tick,
) {
  return context.store.withLock(async () => {
    const stored = await context.store.read();
    if (!stored) throw cliError("PROJECT_NOT_INITIALIZED", "当前项目缺少工程，请先执行 init");
    if (stored.revision !== expected)
      throw cliError("REVISION_CONFLICT", "工程已变化，请重新读取并重新规划");
    const document = validateEditorDocument(stored.data),
      registry = await readRegistry(context.store);
    let draft = document;
    const operations: EditorOperation[] = [],
      receipts = [];
    const step = (ops: EditorOperation[]) => {
      draft = applyEditorOperations(draft, ops, draft.revision);
      operations.push(...ops);
    };
    for (const file of files) {
      registry.set(file.resourceId, file.entry);
      const existing = draft.assets.find((asset) => asset.resourceId === file.resourceId);
      const asset: EditorAsset = existing ?? { id: `asset-${randomUUID()}`, ...file.asset };
      if (!existing) step([{ type: "asset.add", asset }]);
      const receipt: Record<string, unknown> = {
        assetId: asset.id,
        resourceId: file.resourceId,
        name: asset.name,
        kind: asset.kind,
        durationSeconds: seconds(asset.duration),
        ...(asset.width === undefined ? {} : { width: asset.width, height: asset.height }),
        reused: Boolean(existing),
      };
      if (placement.mode !== "none") {
        const sequence = draft.sequences.find((item) => item.id === draft.activeSequenceId)!,
          duration = asset.kind === "image" ? imageDuration : asset.duration,
          lane = asset.kind === "audio" ? "audio" : "video",
          ids = () => `track-${randomUUID()}`;
        if (!duration) throw cliError("INVALID_INPUT", `素材「${asset.name}」没有可放置的时长`);
        let start: Tick, trackId: string;
        if (placement.mode === "append") {
          const planned = planAppendPlacement(sequence, lane, ids);
          step(planned.operations);
          ({ start, trackId } = planned);
        } else {
          start = placement.start;
          if (placement.trackId) {
            const track = sequence.tracks.find((item) => item.id === placement.trackId);
            if (!track || track.kind !== lane || track.locked)
              throw cliError("INVALID_INPUT", "目标轨道不存在、已锁定或与素材类型不符");
            trackId = track.id;
          } else {
            const free = findFreeTrack(sequence, lane, start, duration, ids);
            step(free.operations);
            trackId = free.trackId;
          }
        }
        const clip: MediaClip = {
          id: `clip-${randomUUID()}`,
          kind: "media",
          assetId: asset.id,
          trackId,
          label: asset.name,
          start,
          duration,
          timeMap: asset.kind === "image" ? freezeTimeMap(0, duration) : constantTimeMap(0, duration, 1).timeMap,
          audio: defaultAudioMix(),
          transform: defaultTransform(),
          color: defaultColorAdjustment(),
          blendMode: "normal",
        };
        step([{ type: "clip.add", sequenceId: sequence.id, clip }]);
        receipt.clip = {
          clipId: clip.id,
          trackId,
          startSeconds: seconds(start),
          durationSeconds: seconds(duration),
        };
      }
      receipts.push(receipt);
    }
    const once = operations.length
        ? applyEditorOperations(document, operations, document.revision)
        : document,
      annotations = reconcileEditorProduction(document, once),
      after = annotations.length
        ? applyEditorOperations(document, [...operations, ...annotations], document.revision)
        : once;
    // The list first: an extra entry is harmless, a missing one would strand the document.
    await context.store.writeMedia(registryData(registry));
    const saved = operations.length
      ? await context.store.write(after, stored.revision)
      : { revision: stored.revision };
    return { revision: saved.revision, documentRevision: after.revision, assets: receipts };
  });
}
function placementOf(input: Record<string, any>, fallback: Placement["mode"]): Placement {
  if (input.at !== undefined) {
    if (input.place !== undefined)
      throw cliError("INVALID_INPUT", "at 与 place 只能提供一个");
    return {
      mode: "at",
      start: secondsToTicks(finiteSeconds(input.at, "at")),
      ...(input.trackId === undefined ? {} : { trackId: text(input.trackId, "trackId", 256) }),
    };
  }
  if (input.trackId !== undefined) throw cliError("INVALID_INPUT", "trackId 需要同时提供 at");
  const mode = input.place ?? fallback;
  if (mode !== "append" && mode !== "none")
    throw cliError("INVALID_INPUT", "place 须为 append 或 none");
  return { mode };
}
async function currentRevision(store: Store, expected: unknown) {
  const stored = await store.read();
  if (!stored) throw cliError("PROJECT_NOT_INITIALIZED", "当前项目缺少工程，请先执行 init");
  const revision = revisionOf(expected);
  if (stored.revision !== revision)
    throw cliError("REVISION_CONFLICT", "工程已变化，请重新读取并重新规划");
  return { revision, document: validateEditorDocument(stored.data) };
}

async function addMedia(input: Record<string, any>, context: MediaCommandContext) {
  const { revision } = await currentRevision(context.store, input.expectedRevision);
  if (!Array.isArray(input.files) || !input.files.length || input.files.length > 50)
    throw cliError("INVALID_INPUT", "files 须为 1 至 50 个 {path,name?}");
  const imageDuration = secondsToTicks(
    input.imageSeconds === undefined ? 5 : finiteSeconds(input.imageSeconds, "imageSeconds", 0.04, 3600),
  );
  const placement = placementOf(input, "append");
  const inspected: Inspected[] = [];
  for (const [index, file] of input.files.entries()) {
    if (!plain(file) || Object.keys(file).some((key) => !["path", "name"].includes(key)))
      throw cliError("INVALID_INPUT", "files 每项须为 {path,name?}");
    context.progress("inspect", index / input.files.length);
    inspected.push(
      await inspectFile(
        resolve(context.cwd, text(file.path, "path", 4096)),
        file.name === undefined ? undefined : text(file.name, "name", 256),
        context.store.root,
        context.signal,
      ),
    );
  }
  context.progress("inspect", 1);
  return addInspected(context, revision, inspected, placement, imageDuration);
}

// ---- Shared export settings (plan and render) ----

export function exportSettings(document: EditorDocument, input: Record<string, any>) {
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
    fullDuration = sequenceDuration(sequence);
  const range = validateExportRange(input.range ?? { start: 0, duration: fullDuration }, fullDuration);
  return { sequenceId: sequence.id, sequence, profile, range, fullDuration };
}

// ---- render ----

async function render(input: Record<string, any>, context: MediaCommandContext) {
  const stored = await context.store.read();
  if (!stored) throw cliError("PROJECT_NOT_INITIALIZED", "当前项目缺少工程，请先执行 init");
  if (input.expectedRevision !== undefined && revisionOf(input.expectedRevision) !== stored.revision)
    throw cliError("REVISION_CONFLICT", "工程已变化，请重新读取并重新规划");
  const document = validateEditorDocument(stored.data),
    output = text(input.output, "output");
  const { sequenceId, profile, range, fullDuration } = exportSettings(document, input);
  if (!fullDuration) throw cliError("INVALID_INPUT", "序列为空，先用 add-media 或 edit 放入片段");
  if (extname(output).toLowerCase() !== `.${profile.container}`)
    throw cliError("INVALID_INPUT", `output 须以 .${profile.container} 结尾，与导出配置一致`);
  await context.store.assertFree(output);
  let selected;
  try {
    selected = editorTaskDocument(document, sequenceId);
  } catch (error) {
    throw cliError("MEDIA_NOT_REGISTERED", error instanceof Error ? error.message : String(error));
  }
  const registry = await readRegistry(context.store),
    originals = new Map<string, { path: string; bytes: number }>();
  // Every source must be known before any is read, so the first error names what is missing.
  const unknown = selected.resourceIds.filter((id) => !registry.has(id));
  if (unknown.length) {
    const names = selected.document.assets
      .filter((asset) => unknown.includes(asset.resourceId!))
      .map((asset) => asset.name)
      .slice(0, 5);
    throw cliError(
      "MEDIA_NOT_REGISTERED",
      `序列用到的素材不在本项目的素材登记中：${names.join("、")}；请用 add-media 加入本地文件`,
    );
  }
  for (const [index, id] of selected.resourceIds.entries()) {
    context.progress("verify-media", index / selected.resourceIds.length);
    originals.set(`original-${id}`, await locate(context.store.root, id, registry.get(id)!, context.signal));
  }
  const browserPath = process.env.VIDEO_STUDIO_BROWSER;
  if (browserPath !== undefined && !isAbsolute(browserPath))
    throw cliError("INVALID_ARGUMENT", "VIDEO_STUDIO_BROWSER 须为浏览器可执行文件的绝对路径");
  const home = await cliHome(),
    runtimeDir = await privateDirectory(join(home, "editor-runtime")),
    scopeKey = sha(context.store.root),
    transferId = `editor-${randomUUID()}`,
    bytes = Buffer.from(JSON.stringify(selected.document)),
    documentHash = createHash("sha256").update(bytes).digest("hex");
  const call = (request: Record<string, unknown>, keep?: (jobDir: string, response: any) => Promise<unknown>) =>
    withJob(home, async (jobDir, jobId) => {
      const response = await runEditorRequest(request, {
        jobDir,
        runtimeDir,
        scopeKey,
        jobId,
        signal: context.signal,
        runtimeSource: rendererSource,
        runtimeSha: rendererSha,
        builtinNarrationPath: fileURLToPath(new URL("../demo-narration.mp3", import.meta.url)),
        originals: originals as EditorOriginals,
        ...(browserPath ? { tools: { browserPath } } : {}),
        reportProgress: (value) => context.progress(value.stage ?? String(request.action), value.fraction),
      });
      return keep ? keep(jobDir, response) : response;
    });
  try {
    if (selected.resourceIds.length)
      await call({ action: "stage-resources", transferId, resourceIds: selected.resourceIds });
    const chunk = 512 * 1024,
      chunkCount = Math.ceil(bytes.length / chunk);
    for (let index = 0; index < chunkCount; index++)
      await call({
        action: "stage-document",
        transferId,
        documentHash,
        chunkIndex: index,
        chunkCount,
        dataBase64: bytes.subarray(index * chunk, (index + 1) * chunk).toString("base64"),
      });
    await call({
      action: "commit",
      transferId,
      documentHash,
      sequenceId,
      chunkCount,
      byteLength: bytes.length,
    });
    const isFull = range.start === 0 && range.duration === fullDuration;
    return await call(
      {
        action: "render",
        transferId,
        documentHash,
        sequenceId,
        profile,
        ...(isFull ? {} : { range }),
      },
      async (jobDir, response) => {
        const video = response.artifacts.find((item: any) => item.role === "editor-video");
        if (!video) throw cliError("RENDER_FAILED", "渲染没有产出视频");
        await context.store.publishFile(output, join(jobDir, video.file));
        return {
          rendered: true,
          verified: response.result.verified === true,
          output,
          bytes: video.bytes,
          sha256: video.sha256,
          sequenceId,
          profile: {
            id: profile.id,
            name: profile.name,
            container: profile.container,
            width: profile.width,
            height: profile.height,
            frameRate: profile.frameRate,
          },
          range: { startSeconds: seconds(range.start), durationSeconds: seconds(range.duration) },
          frameCount: response.result.frameCount,
          durationSeconds: response.result.durationSeconds,
          reusedAudio: response.result.reusedAudio === true,
          ...(response.result.audioMix?.warning ? { audioWarning: response.result.audioMix.warning } : {}),
        };
      },
    );
  } finally {
    await call({ action: "discard", transferId, documentHash, sequenceId }).catch(() => {});
  }
}

// ---- voices, setup-voice, voiceover ----

async function media(params: Record<string, unknown>, action: string, context: MediaCommandContext) {
  const home = await cliHome(),
    runtimeDir = await privateDirectory(join(home, "media-runtime"));
  return withJob(home, async (jobDir, jobId) => {
    const response = await runMediaRequest(
      { action: action as any, params },
      {
        jobDir,
        runtimeDir,
        scopeKey: sha(context.store.root),
        jobId,
        signal: context.signal,
        reportProgress: (value) => context.progress(value.stage ?? action, value.fraction),
      },
    );
    return { response, jobDir };
  });
}

async function voices(input: Record<string, any>, context: MediaCommandContext) {
  const language = input.language === undefined ? undefined : text(input.language, "language", 32);
  const home = await cliHome(),
    runtimeDir = await privateDirectory(join(home, "media-runtime"));
  const result = await withJob(home, async (jobDir, jobId) =>
    (
      await runMediaRequest(
        { action: "voices" },
        {
          jobDir,
          runtimeDir,
          scopeKey: sha(context.store.root),
          jobId,
          signal: context.signal,
          reportProgress: () => {},
        },
      )
    ).result,
  );
  const models = (result.models as any[])
    .filter((model) => input.modelId === undefined || model.id === input.modelId)
    .map((model) => {
      const all = (model.voices ?? []).filter(
        (voice: any) =>
          !language || String(voice.language ?? "").toLowerCase().startsWith(language.toLowerCase()),
      );
      return {
        id: model.id,
        name: model.name,
        provider: model.provider,
        available: model.available === true,
        ...(model.reason ? { reason: model.reason } : {}),
        ...(model.installable ? { installable: true } : {}),
        defaultVoiceId: model.defaultVoiceId,
        voiceCount: all.length,
        voices: all.slice(0, 40).map((voice: any) => ({
          id: voice.id,
          name: voice.name,
          ...(voice.language ? { language: voice.language } : {}),
        })),
      };
    });
  return {
    defaultModelId: result.defaultModelId,
    models,
    next: "未安装的引擎用 setup-voice {providerId}；生成用 voiceover {text,modelId,voiceId}",
  };
}

async function setupVoice(input: Record<string, any>, context: MediaCommandContext) {
  if (!["edge-tts", "kokoro"].includes(input.providerId))
    throw cliError("INVALID_INPUT", "providerId 须为 edge-tts 或 kokoro");
  const { response } = await media({ providerId: input.providerId }, "tts-setup", context);
  const result = response.result ?? {};
  return {
    providerId: input.providerId,
    available: result.available === true,
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.version ? { version: result.version } : {}),
  };
}

async function voiceover(input: Record<string, any>, context: MediaCommandContext) {
  const { revision } = await currentRevision(context.store, input.expectedRevision);
  const words = text(input.text, "text", 6000),
    placement = placementOf(input, "none");
  if (
    input.rate !== undefined &&
    (typeof input.rate !== "number" || !(input.rate >= 0.5 && input.rate <= 2))
  )
    throw cliError("INVALID_INPUT", "rate 须为 0.5 至 2 之间的语速倍数");
  const output =
    input.output === undefined
      ? `media/voiceover-${sha(`${words}\0${input.modelId ?? ""}\0${input.voiceId ?? ""}\0${input.rate ?? 1}`).slice(0, 12)}.wav`
      : text(input.output, "output");
  if (extname(output).toLowerCase() !== ".wav") throw cliError("INVALID_INPUT", "output 须以 .wav 结尾");
  await context.store.assertFree(output);
  const { speech, published } = await (async () => {
    const home = await cliHome(),
      runtimeDir = await privateDirectory(join(home, "media-runtime"));
    return withJob(home, async (jobDir, jobId) => {
      const response = await runMediaRequest(
        {
          action: "tts",
          params: {
            text: words,
            ...(input.modelId === undefined ? {} : { modelId: text(input.modelId, "modelId", 128) }),
            ...(input.voiceId === undefined ? {} : { voiceId: text(input.voiceId, "voiceId", 256) }),
            ...(input.rate === undefined ? {} : { rate: input.rate }),
          },
        },
        {
          jobDir,
          runtimeDir,
          scopeKey: sha(context.store.root),
          jobId,
          signal: context.signal,
          reportProgress: (value) => context.progress(value.stage ?? "tts", value.fraction),
        },
      );
      const artifact = response.artifacts.find((item) => item.mimeType === "audio/wav");
      if (!artifact) throw cliError("TTS_FAILED", "配音没有产出音频");
      return {
        speech: response.result.speech,
        published: await context.store.publishFile(output, join(jobDir, artifact.file)),
      };
    });
  })();
  const inspected = await inspectFile(
    published,
    input.name === undefined ? `配音 · ${Array.from(words).slice(0, 16).join("")}` : text(input.name, "name", 256),
    context.store.root,
    context.signal,
  );
  const added = await addInspected(context, revision, [inspected], placement, 0);
  return {
    ...added,
    output,
    speech: { modelId: speech?.modelId, voiceId: speech?.voiceId, engine: speech?.engine, rate: speech?.rate },
  };
}

// ---- transcribe ----

async function sourceFile(input: Record<string, any>, context: MediaCommandContext) {
  if ((input.assetId === undefined) === (input.path === undefined))
    throw cliError("INVALID_INPUT", "assetId 与 path 须且只能提供一个");
  if (input.path !== undefined) {
    const path = await context.store.existingFile(text(input.path, "path"));
    return { path, label: basename(path, extname(path)) };
  }
  const stored = await context.store.read();
  if (!stored) throw cliError("PROJECT_NOT_INITIALIZED", "当前项目缺少工程，请先执行 init");
  const document = validateEditorDocument(stored.data),
    asset = document.assets.find((item) => item.id === input.assetId);
  if (!asset) throw cliError("INVALID_INPUT", "素材不存在");
  const entry = asset.resourceId ? (await readRegistry(context.store)).get(asset.resourceId) : undefined;
  if (!entry || !asset.resourceId)
    throw cliError("MEDIA_NOT_REGISTERED", `素材「${asset.name}」不在本项目的素材登记中`);
  const located = await locate(context.store.root, asset.resourceId, entry, context.signal);
  return { path: located.path, label: asset.name.replace(/\.[^.]+$/, ""), asset };
}
const safeStem = (value: string) =>
  value.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "media";

async function transcribe(input: Record<string, any>, context: MediaCommandContext) {
  const { path, label } = await sourceFile(input, context);
  const language = input.language === undefined ? undefined : text(input.language, "language", 8);
  const model = input.model ?? "base";
  if (!/^[a-z0-9.-]{1,32}$/.test(model)) throw cliError("INVALID_INPUT", "model 须为 Whisper 模型名，如 base、small");
  const modelPath = join(homedir(), ".cache", "whisper", `${model}.pt`);
  const directory = input.output === undefined ? "transcripts" : text(input.output, "output");
  const stem = `${safeStem(label)}-${sha(path).slice(0, 8)}`,
    jsonOutput = `${directory}/${stem}.json`,
    srtOutput = `${directory}/${stem}.srt`;
  await context.store.assertFree(jsonOutput);
  await context.store.assertFree(srtOutput);
  const [ffmpegPath, ffprobePath, whisperPath] = await Promise.all([
    tool("ffmpeg"),
    tool("ffprobe"),
    tool("whisper"),
  ]);
  const home = await cliHome(),
    runtimeDir = await privateDirectory(join(home, "media-runtime"));
  return withJob(home, async (jobDir, jobId) => {
    const processors = createMediaJobProcessors({
      ffmpegPath,
      ffprobePath,
      whisperPath,
      whisperModelPath: modelPath,
      resolveAssetPath: async () => path,
    });
    const workDir = await privateDirectory(join(jobDir, "work")),
      outputDir = await privateDirectory(join(jobDir, "outputs")),
      cacheDir = await privateDirectory(join(runtimeDir, "cache", sha(context.store.root)));
    const result = (await processors.transcribe!.run(
      { assetId: "cli-source", ...(language ? { language } : {}) },
      {
        scope: { appId: "video-studio", projectPath: sha(context.store.root) },
        jobId,
        attempt: 1,
        signal: context.signal,
        workDir,
        outputDir,
        cacheDir,
        reportProgress: async (value) => context.progress(value.stage ?? "transcribe", value.fraction),
      },
    )) as any;
    const transcript = JSON.parse(
      await (await import("node:fs/promises")).readFile(result.transcript.path, "utf8"),
    );
    await context.store.publishFile(jsonOutput, result.transcript.path);
    if (result.subtitles?.path) await context.store.publishFile(srtOutput, result.subtitles.path);
    const all = String(transcript.text ?? "").trim();
    return {
      language: result.language,
      model: result.model,
      durationSeconds: result.durationSeconds,
      segmentCount: result.segmentCount,
      wordCount: result.wordCount,
      time: "source seconds of this media file, not sequence time",
      files: { json: jsonOutput, ...(result.subtitles?.path ? { srt: srtOutput } : {}) },
      textPreview: all.length > 2000 ? `${all.slice(0, 2000)}…` : all,
      segments: transcript.segments
        .slice(0, 60)
        .map((segment: any) => ({
          start: Math.round(segment.start * 1000) / 1000,
          end: Math.round(segment.end * 1000) / 1000,
          text: String(segment.text).trim(),
        })),
      ...(transcript.segments.length > 60 ? { segmentsTruncated: true } : {}),
    };
  });
}

// ---- frames ----

async function frames(input: Record<string, any>, context: MediaCommandContext) {
  const { path } = await sourceFile(input, context);
  if (!Array.isArray(input.times) || !input.times.length || input.times.length > 36)
    throw cliError("INVALID_INPUT", "times 须为 1 至 36 个秒数");
  const times = input.times.map((value: unknown) => finiteSeconds(value, "times"));
  const width = input.width === undefined ? 640 : input.width;
  if (!Number.isSafeInteger(width) || width < 160 || width > 1920)
    throw cliError("INVALID_INPUT", "width 须为 160 至 1920 的整数");
  const directory = text(input.output, "output"),
    sheet = input.sheet !== false,
    names = times.map((time: number, index: number) =>
      `${directory}/frame-${String(index + 1).padStart(2, "0")}-${time.toFixed(2)}s.jpg`,
    );
  for (const name of [...names, ...(sheet ? [`${directory}/sheet.jpg`] : [])])
    await context.store.assertFree(name);
  const ffmpeg = await tool("ffmpeg"),
    home = await cliHome();
  return withJob(home, async (jobDir) => {
    for (const [index, time] of times.entries()) {
      context.progress("frames", index / times.length);
      await runMediaProcess(
        ffmpeg,
        [
          "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
          "-ss", String(time), "-i", path,
          "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "3",
          join(jobDir, `frame-${String(index + 1).padStart(3, "0")}.jpg`),
        ],
        { signal: context.signal, cwd: jobDir },
      );
    }
    const extracted = (await readdir(jobDir)).filter((name) => /^frame-\d{3}\.jpg$/.test(name)).sort();
    if (extracted.length !== times.length)
      throw cliError("FRAMES_FAILED", "部分时间点没有画面（可能超出素材时长）");
    for (const [index, name] of extracted.entries())
      await context.store.publishFile(names[index], join(jobDir, name));
    let sheetFile: string | undefined;
    if (sheet) {
      const columns = Math.min(4, times.length),
        rows = Math.ceil(times.length / columns);
      await runMediaProcess(
        ffmpeg,
        [
          "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
          "-framerate", "1", "-i", join(jobDir, "frame-%03d.jpg"),
          "-vf", `tile=${columns}x${rows}:padding=6:margin=6:color=0x111111`,
          "-frames:v", "1", "-q:v", "3", join(jobDir, "sheet.jpg"),
        ],
        { signal: context.signal, cwd: jobDir },
      );
      await context.store.publishFile(`${directory}/sheet.jpg`, join(jobDir, "sheet.jpg"));
      sheetFile = `${directory}/sheet.jpg`;
    }
    context.progress("frames", 1);
    return {
      frames: times.map((time: number, index: number) => ({ seconds: time, file: names[index] })),
      ...(sheetFile ? { sheet: sheetFile, sheetOrder: "left to right, top to bottom" } : {}),
    };
  });
}

// ---- Command table ----

const revisionSchema = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const sourceSchema = { assetId: { type: "string" }, path: { type: "string" } };
const placeSchema = {
  place: { enum: ["append", "none"] },
  at: { type: "number", minimum: 0, description: "Sequence seconds; places on a free track" },
  trackId: { type: "string", description: "Only with at" },
};

export const mediaCommands = [
  {
    name: "add-media",
    readOnly: false,
    long: false,
    fields: ["expectedRevision", "files", "place", "at", "trackId", "imageSeconds"],
    inputSchema: object(
      {
        expectedRevision: revisionSchema,
        files: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: object({ path: { type: "string" }, name: { type: "string" } }, ["path"]),
        },
        ...placeSchema,
        imageSeconds: { type: "number", minimum: 0.04, maximum: 3600 },
      },
      ["expectedRevision", "files"],
    ),
    description:
      "Register local video/audio/image files (read in place, never copied) and add them as assets; place defaults to append on the main picture or first audio track.",
  },
  {
    name: "render",
    readOnly: false,
    long: true,
    fields: ["expectedRevision", "sequenceId", "profileId", "profile", "range", "output"],
    inputSchema: object(
      {
        expectedRevision: revisionSchema,
        sequenceId: { type: "string" },
        profileId: { type: "string" },
        profile: { type: "object" },
        range: object({ start: { type: "integer" }, duration: { type: "integer" } }, ["start", "duration"]),
        output: { type: "string", description: "New project-relative file, e.g. renders/cut.mp4" },
      },
      ["output"],
    ),
    description:
      "Render the sequence to a real, verified video file with the panel's own renderer (FFmpeg + Chrome). Never overwrites.",
  },
  {
    name: "voices",
    readOnly: true,
    long: false,
    fields: ["modelId", "language"],
    inputSchema: object({ modelId: { type: "string" }, language: { type: "string" } }),
    description: "List voice models (macOS say, Edge, Kokoro) and their voices; language filters voices, e.g. zh.",
  },
  {
    name: "setup-voice",
    readOnly: false,
    long: true,
    fields: ["providerId"],
    inputSchema: object({ providerId: { enum: ["edge-tts", "kokoro"] } }, ["providerId"]),
    description: "Install and verify a voice engine on this device (needs uv); shared by all CLI projects.",
  },
  {
    name: "voiceover",
    readOnly: false,
    long: true,
    fields: ["expectedRevision", "text", "modelId", "voiceId", "rate", "output", "name", "place", "at", "trackId"],
    inputSchema: object(
      {
        expectedRevision: revisionSchema,
        text: { type: "string", minLength: 1, maxLength: 6000 },
        modelId: { type: "string" },
        voiceId: { type: "string" },
        rate: { type: "number", minimum: 0.5, maximum: 2 },
        output: { type: "string", description: "New .wav below the project; default media/voiceover-<hash>.wav" },
        name: { type: "string" },
        ...placeSchema,
      },
      ["expectedRevision", "text"],
    ),
    description:
      "Synthesize narration into a .wav in the project and add it as an asset; at places it on a free audio track (default: not placed).",
  },
  {
    name: "transcribe",
    readOnly: false,
    long: true,
    fields: ["assetId", "path", "language", "model", "output"],
    inputSchema: object(
      {
        ...sourceSchema,
        language: { type: "string", description: "e.g. zh, en; default auto" },
        model: { type: "string", description: "Whisper model in ~/.cache/whisper, default base" },
        output: { type: "string", description: "Project directory, default transcripts" },
      },
    ),
    description:
      "Local Whisper transcript of a registered asset or project file: writes .json and .srt (source-time seconds) and returns segments.",
  },
  {
    name: "frames",
    readOnly: false,
    long: false,
    fields: ["assetId", "path", "times", "width", "output", "sheet"],
    inputSchema: object(
      {
        ...sourceSchema,
        times: { type: "array", minItems: 1, maxItems: 36, items: { type: "number", minimum: 0 } },
        width: { type: "integer", minimum: 160, maximum: 1920 },
        output: { type: "string", description: "New project directory for the JPEGs" },
        sheet: { type: "boolean", description: "Also write sheet.jpg, default true" },
      },
      ["times", "output"],
    ),
    description:
      "Extract JPEG frames (and a contact sheet) from a rendered file or asset so the result can be looked at.",
  },
] as const;

const runners: Record<string, (input: Record<string, any>, context: MediaCommandContext) => Promise<unknown>> = {
  "add-media": addMedia,
  render,
  voices,
  "setup-voice": setupVoice,
  voiceover,
  transcribe,
  frames,
};
export function runMediaCommand(command: string, input: Record<string, any>, context: MediaCommandContext) {
  return runners[command]!(input, context);
}
