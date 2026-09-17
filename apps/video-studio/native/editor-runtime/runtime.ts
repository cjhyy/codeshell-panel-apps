import { copyFile, lstat, readdir, rename, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  EDITOR_TASK_LIMITS,
  EDITOR_DEMO_NARRATION_SHA,
  isEditorDemoNarration,
  editorTaskDocument,
  editorProjectDocument,
  type PreparedEditorAudio,
} from "../../src/editor/task-bridge.js";
import type { EditorDocument } from "../../src/editor/types.js";
import { renderEditorAudio } from "../media/editor-audio-renderer.js";
import { exportEditorSequence } from "../media/editor-export.js";
import { runMediaProcess } from "../process-runner.js";
import {
  abort,
  atomic,
  bytesHash,
  digest,
  directory,
  fileHash,
  json,
  optionalJson,
  publish,
  readBytes,
  readPrefix,
  regular,
  sealed,
  type EditorArtifact,
} from "./files.js";
import { EditorTaskError, hash, record, resourceId, validateEditorRequest } from "./protocol.js";
import { exportPortableProject } from "./bundle.js";
import { runPortableImportRequest, portableTaskError } from "./bundle-tasks.js";
import { analyzeEditorWaveform } from "./waveform.js";
import { alignEditorMulticam } from "./multicam.js";
import { inspectEditorSource } from "./inspect.js";
import { prepareEditorProxy, type EditorProxy } from "./proxy.js";

export interface EditorRuntimeContext {
  jobDir: string;
  runtimeDir: string;
  scopeKey: string;
  jobId: string;
  signal: AbortSignal;
  runtimeSource: string;
  runtimeSha: string;
  reportProgress(progress: {
    fraction?: number;
    stage?: string;
    message?: string;
  }): void | Promise<void>;
  /** Reviewed package/test configuration, never accepted from task JSON. */
  builtinNarrationPath?: string;
  tools?: { ffmpegPath?: string; ffprobePath?: string; browserPath?: string };
}
interface Binding {
  resourceId: string;
  sha256: string;
  bytes: number;
}
interface Manifest {
  kind?: "project";
  documentHash: string;
  sequenceId: string;
  document: EditorDocument;
  bindings: Binding[];
}
interface MixReceipt extends PreparedEditorAudio {
  sampleCount: number;
  peak: number;
  samplesOverFullScale: number;
  reportHash: string;
}
const artifactValue = (artifact: EditorArtifact) => ({
  id: artifact.assetId,
  name: artifact.name,
  mimeType: artifact.mimeType,
  bytes: artifact.bytes,
  sha256: artifact.sha256,
});

/** Installed-domain implementation: all filenames below are derived here, never passed in by a webview. */
export async function runEditorRequest(
  raw: unknown,
  context: EditorRuntimeContext,
): Promise<{ result: any; artifacts: EditorArtifact[] }> {
  const request = validateEditorRequest(raw);
  abort(context.signal);
  hash(context.scopeKey);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(context.jobId))
    throw new EditorTaskError("INVALID_REQUEST", "主程序任务编号无效");
  const root = await sealed(context.jobDir),
    runtime = await sealed(context.runtimeDir);
  if (request.action === "inspect-source") {
    const id = request.resourceIds![0]!,
      input = await regular(root, ["inputs", "resource-0.bin"]);
    await context.reportProgress({ fraction: 0, stage: "inspect-source" });
    const result = await inspectEditorSource(
      input,
      id,
      context.tools?.ffprobePath ?? "ffprobe",
      context.signal,
    );
    if ((await fileHash(input, context.signal)) !== result.sha256)
      throw new EditorTaskError("SOURCE_CHANGED", "素材在分析过程中发生变化，请重新导入");
    await context.reportProgress({ fraction: 1, stage: "complete" });
    return { result, artifacts: [] };
  }
  const scope = await directory(runtime, ["scopes", context.scopeKey]);
  const transfer = await directory(scope, ["transfers", request.transferId]);
  const work = await directory(root, [`work-${randomUUID()}`]);
  const resources = await directory(transfer, ["resources"]);
  const cache = await directory(scope, ["cache"]);
  const artifacts: EditorArtifact[] = [];
  let succeeded = false;
  const progress = async (fraction: number, stage: string, message?: string) => {
    abort(context.signal);
    await context.reportProgress({ fraction, stage, ...(message ? { message } : {}) });
  };
  const add = async (path: string, extension: string, mimeType: string, role: string) => {
    const artifact = await publish(root, path, extension, mimeType, role, context.signal);
    if (!artifacts.some((item) => item.assetId === artifact.assetId)) artifacts.push(artifact);
    if (artifacts.length > 128)
      throw new EditorTaskError("LIMIT_EXCEEDED", "本批输出超过 128 个资源，请继续分批准备");
    return artifactValue(artifact);
  };
  const report = async (value: unknown) => {
    const path = join(work, `report-${randomUUID()}.json`);
    await atomic(path, Buffer.from(JSON.stringify(value)));
    return add(path, "json", "application/json", "editor-report");
  };
  const material = async (binding: Binding): Promise<string> => {
    const id = resourceId(binding.resourceId),
      path = await regular(resources, [`${id}.bin`]);
    if (
      (await fileHash(path, context.signal)) !== hash(binding.sha256) ||
      (await stat(path)).size !== binding.bytes
    )
      throw new EditorTaskError("SOURCE_CHANGED", "已准备素材内容发生变化，请重新建立快照");
    return path;
  };
  const builtin = async () => {
    const id = `asset-${EDITOR_DEMO_NARRATION_SHA}`;
    let binding = (await optionalJson(resources, [`${id}.json`])) as Binding | undefined;
    if (!binding) {
      if (
        !context.builtinNarrationPath ||
        (await fileHash(context.builtinNarrationPath, context.signal)) !== EDITOR_DEMO_NARRATION_SHA
      )
        throw new EditorTaskError(
          "BUILTIN_CHANGED",
          "安装包中的示例旁白缺失或校验失败，请重新安装视频面板",
        );
      const bytes = (await stat(context.builtinNarrationPath)).size;
      const temporary = join(resources, `${id}.${randomUUID()}.tmp`);
      try {
        await copyFile(context.builtinNarrationPath, temporary);
        if ((await fileHash(temporary, context.signal)) !== EDITOR_DEMO_NARRATION_SHA)
          throw new EditorTaskError("BUILTIN_CHANGED", "示例旁白内容变化");
        await rename(temporary, join(resources, `${id}.bin`));
        binding = { resourceId: id, sha256: EDITOR_DEMO_NARRATION_SHA, bytes };
        await atomic(join(resources, `${id}.json`), Buffer.from(JSON.stringify(binding)));
      } finally {
        await rm(temporary, { force: true });
      }
    }
    if (binding.sha256 !== EDITOR_DEMO_NARRATION_SHA || binding.resourceId !== id)
      throw new EditorTaskError("BUILTIN_CHANGED", "示例旁白回执无效");
    return { binding, path: await material(binding) };
  };
  try {
    if (request.action === "align-multicam") {
      const settings = request.alignment!,
        sources = [];
      for (const [index, resourceId] of request.resourceIds!.entries()) {
        const path = await regular(root, ["inputs", `resource-${index}.bin`]),
          sha = await fileHash(path, context.signal);
        if (
          (resourceId.startsWith("asset-") && resourceId !== `asset-${sha}`) ||
          (settings.sourceHashes?.[index] && settings.sourceHashes[index] !== sha)
        )
          throw new EditorTaskError("SOURCE_CHANGED", "机位素材内容与资源编号或工程指纹不匹配");
        sources.push({ resourceId, path, duration: settings.sourceDurations[index]! });
      }
      await progress(0, "align-multicam");
      const result = await alignEditorMulticam({
        sources,
        referenceResourceId: settings.referenceResourceId,
        windowSeconds: settings.windowSeconds,
        maxOffsetSeconds: settings.maxOffsetSeconds,
        cacheDir: await directory(cache, ["multicam"]),
        pcmCacheDir: await directory(cache, ["pcm"]),
        ffmpegPath: context.tools?.ffmpegPath ?? "ffmpeg",
        ffprobePath: context.tools?.ffprobePath ?? "ffprobe",
        signal: context.signal,
      });
      await progress(1, "complete");
      succeeded = true;
      return {
        result: { ...result, ...(settings.origin ? { origin: settings.origin } : {}) },
        artifacts,
      };
    }
    if (request.action === "prepare-source-video") {
      const id = request.resourceIds![0]!,
        input = await regular(root, ["inputs", "resource-0.bin"]),
        sourceHash = await fileHash(input, context.signal);
      if (id.startsWith("asset-") && id !== `asset-${sourceHash}`)
        throw new EditorTaskError("SOURCE_CHANGED", "素材内容与资源编号不匹配");
      await progress(0, "prepare-source-video");
      const ffmpegPath = context.tools?.ffmpegPath ?? "ffmpeg",
        ffprobePath = context.tools?.ffprobePath ?? "ffprobe";
      const ffmpegVersion = (
        await runMediaProcess(ffmpegPath, ["-hide_banner", "-version"], { signal: context.signal })
      ).stdout.toString();
      const proxy = await prepareEditorProxy(input, sourceHash, {
        ffmpegPath,
        ffprobePath,
        ffmpegVersion,
        cacheDir: cache,
        workDir: work,
        signal: context.signal,
      });
      if ((await fileHash(input, context.signal)) !== sourceHash)
        throw new EditorTaskError("SOURCE_CHANGED", "素材在兼容画面准备时发生变化");
      const artifact = await add(proxy.path, "mp4", "video/mp4", "editor-video-source"),
        { path: _path, ...recipe } = proxy;
      await progress(1, "complete");
      succeeded = true;
      return { result: { resourceId: id, sourceHash, proxy: artifact, recipe }, artifacts };
    }
    if (request.action === "analyze-waveform") {
      const id = request.resourceIds![0]!,
        input = await regular(root, ["inputs", "resource-0.bin"]);
      await progress(0, "analyze-waveform");
      const analysis = await analyzeEditorWaveform({
        input,
        sourceDuration: request.sourceDuration!,
        cacheDir: await directory(cache, ["waveforms"]),
        pcmCacheDir: await directory(cache, ["pcm"]),
        ffmpegPath: context.tools?.ffmpegPath ?? "ffmpeg",
        ffprobePath: context.tools?.ffprobePath ?? "ffprobe",
        signal: context.signal,
      });
      if (id.startsWith("asset-") && id !== `asset-${analysis.sourceHash}`)
        throw new EditorTaskError("SOURCE_CHANGED", "素材内容与资源编号不匹配");
      const waveform = await add(analysis.path, "json", "application/json", "editor-waveform");
      await progress(1, "complete");
      succeeded = true;
      return {
        result: {
          resourceId: id,
          sourceHash: analysis.sourceHash,
          recipeHash: analysis.recipeHash,
          waveform,
          reused: analysis.reused,
          reusedPcm: analysis.reusedPcm,
        },
        artifacts,
      };
    }
    if (
      [
        "import-project",
        "project-import-status",
        "publish-project-media",
        "discard-project-import",
      ].includes(request.action)
    ) {
      const result = await runPortableImportRequest(request, {
        root,
        transfer,
        signal: context.signal,
        add,
        progress,
      }).catch(portableTaskError);
      succeeded = true;
      return { result, artifacts };
    }
    const discarded = await optionalJson(transfer, ["discarded.json"]);
    if (discarded && request.action !== "discard")
      throw new EditorTaskError("TRANSFER_DISCARDED", "此快照已释放，请创建新的准备任务");
    if (request.action === "stage-status") {
      const present: string[] = [];
      for (const id of request.resourceIds!) {
        const binding = await optionalJson(resources, [`${id}.json`]);
        if (binding) {
          await material(binding);
          present.push(id);
        }
      }
      const chunks: number[] = [],
        documentDir = await directory(transfer, ["documents", request.documentHash!]);
      for (const name of await readdir(documentDir))
        if (/^chunk-\d+\.json$/.test(name)) {
          const receipt = await json(documentDir, [name]);
          const index = Number(/^chunk-(\d+)\.json$/.exec(name)![1]);
          if (index >= EDITOR_TASK_LIMITS.documentBytes / EDITOR_TASK_LIMITS.chunkBytes) continue;
          const bytes = await readBytes(
            documentDir,
            [`chunk-${index}.bin`],
            EDITOR_TASK_LIMITS.chunkBytes,
          );
          if (receipt.sha256 === bytesHash(bytes)) chunks.push(index);
        }
      const manifest = await optionalJson(
        transfer,
        ["manifest.json"],
        EDITOR_TASK_LIMITS.documentBytes + 2 * 1024 * 1024,
      );
      succeeded = true;
      return {
        result: {
          resourceIds: present,
          chunks: chunks.sort((a, b) => a - b),
          ...(manifest
            ? {
                committedDocumentHash: manifest.documentHash,
                sequenceId: manifest.sequenceId,
                ...(manifest.kind ? { kind: manifest.kind } : {}),
              }
            : {}),
        },
        artifacts,
      };
    }
    if (request.action === "stage-resources") {
      const staged: Binding[] = [];
      for (let index = 0; index < request.resourceIds!.length; index++) {
        const id = request.resourceIds![index]!;
        const path = await regular(root, ["inputs", `resource-${index}.bin`]);
        const bytes = (await stat(path)).size;
        if (bytes < 1 || bytes > 20 * 1024 ** 3)
          throw new EditorTaskError("LIMIT_EXCEEDED", "素材超过当前 20GiB 资源大小限制");
        const sha256 = await fileHash(path, context.signal);
        if (id.startsWith("asset-") && id !== `asset-${sha256}`)
          throw new EditorTaskError("SOURCE_CHANGED", "主程序素材内容校验失败");
        const binding: Binding = { resourceId: id, sha256, bytes };
        const previous = await optionalJson(resources, [`${id}.json`]);
        if (previous && (previous.sha256 !== sha256 || previous.bytes !== bytes))
          throw new EditorTaskError("SOURCE_CHANGED", "同一快照中的原文件已变化，请创建新快照");
        if (previous) await material(previous);
        else {
          const temporary = join(resources, `${id}.${randomUUID()}.tmp`);
          try {
            await copyFile(path, temporary);
            abort(context.signal);
            if ((await fileHash(temporary, context.signal)) !== sha256)
              throw new EditorTaskError("SOURCE_CHANGED", "素材在准备时发生变化");
            await rename(temporary, join(resources, `${id}.bin`));
            await atomic(join(resources, `${id}.json`), Buffer.from(JSON.stringify(binding)));
          } finally {
            await rm(temporary, { force: true });
          }
        }
        staged.push(binding);
        await progress((index + 1) / request.resourceIds!.length, "stage-resources");
      }
      succeeded = true;
      return { result: { resources: staged }, artifacts };
    }
    if (request.action === "stage-document") {
      const bytes = Buffer.from(request.dataBase64!, "base64");
      if (
        !bytes.length ||
        bytes.length > EDITOR_TASK_LIMITS.chunkBytes ||
        bytes.toString("base64") !== request.dataBase64
      )
        throw new EditorTaskError("INVALID_REQUEST", "工程数据块编码无效");
      const committed = await optionalJson(
        transfer,
        ["manifest.json"],
        EDITOR_TASK_LIMITS.documentBytes + 2 * 1024 * 1024,
      );
      if (committed && committed.documentHash !== request.documentHash)
        throw new EditorTaskError("SNAPSHOT_MISMATCH", "快照已提交，请为新修改建立新的快照");
      const doc = await directory(transfer, ["documents", request.documentHash!]);
      const metadata = await optionalJson(doc, ["chunks.json"]);
      if (metadata && metadata.count !== request.chunkCount)
        throw new EditorTaskError("INVALID_REQUEST", "工程数据块总数不一致");
      await atomic(
        join(doc, "chunks.json"),
        Buffer.from(JSON.stringify({ count: request.chunkCount })),
      );
      await atomic(join(doc, `chunk-${request.chunkIndex}.bin`), bytes);
      await atomic(
        join(doc, `chunk-${request.chunkIndex}.json`),
        Buffer.from(JSON.stringify({ sha256: bytesHash(bytes) })),
      );
      succeeded = true;
      return { result: { chunkIndex: request.chunkIndex, bytes: bytes.length }, artifacts };
    }
    if (request.action === "commit" || request.action === "commit-project") {
      const project = request.action === "commit-project";
      const previous = await optionalJson(
        transfer,
        ["manifest.json"],
        EDITOR_TASK_LIMITS.documentBytes + 2 * 1024 * 1024,
      );
      if (
        previous &&
        (previous.documentHash !== request.documentHash ||
          previous.sequenceId !== request.sequenceId ||
          (previous.kind === "project") !== project)
      )
        throw new EditorTaskError("SNAPSHOT_MISMATCH", "快照已提交，请为新修改建立新的快照");
      const doc = await directory(transfer, ["documents", request.documentHash!]);
      const metadata = await json(doc, ["chunks.json"]);
      if (metadata.count !== request.chunkCount)
        throw new EditorTaskError("INCOMPLETE_STAGE", "工程数据块尚未完整准备");
      const chunks: Buffer[] = [];
      let total = 0;
      for (let index = 0; index < request.chunkCount!; index++) {
        const bytes = await readBytes(doc, [`chunk-${index}.bin`], EDITOR_TASK_LIMITS.chunkBytes);
        total += bytes.length;
        if (
          total > EDITOR_TASK_LIMITS.documentBytes ||
          (index < request.chunkCount! - 1 && bytes.length !== EDITOR_TASK_LIMITS.chunkBytes)
        )
          throw new EditorTaskError("INCOMPLETE_STAGE", "工程数据块长度不一致");
        chunks.push(bytes);
      }
      const bytes = Buffer.concat(chunks);
      if (total !== request.byteLength || bytesHash(bytes) !== request.documentHash)
        throw new EditorTaskError("SNAPSHOT_MISMATCH", "工程内容校验失败，请重新分批准备");
      const rawDocument = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
      const selected = project
        ? editorProjectDocument(rawDocument)
        : editorTaskDocument(rawDocument, request.sequenceId!);
      if (project && selected.document.activeSequenceId !== request.sequenceId)
        throw new EditorTaskError("SNAPSHOT_MISMATCH", "完整工程的当前序列不一致");
      if (bytesHash(Buffer.from(JSON.stringify(selected.document))) !== request.documentHash)
        throw new EditorTaskError("SNAPSHOT_MISMATCH", "工程快照不是规范化的依赖闭包");
      const bindings: Binding[] = [];
      for (const id of selected.resourceIds) {
        const binding = await json(resources, [`${id}.json`]);
        await material(binding);
        bindings.push(binding);
      }
      if (selected.document.assets.some(isEditorDemoNarration)) await builtin();
      const manifest: Manifest = {
        ...(project ? { kind: "project" as const } : {}),
        documentHash: request.documentHash!,
        sequenceId: request.sequenceId!,
        document: selected.document,
        bindings,
      };
      await atomic(join(transfer, "manifest.json"), Buffer.from(JSON.stringify(manifest)));
      succeeded = true;
      return {
        result: {
          documentHash: manifest.documentHash,
          sequenceId: manifest.sequenceId,
          documentId: manifest.document.id,
          revision: manifest.document.revision,
          resourceCount: bindings.length,
          ...(project ? { kind: "project" } : {}),
        },
        artifacts,
      };
    }
    if (request.action === "discard") {
      await atomic(join(transfer, "discarded.json"), Buffer.from("{}"));
      for (const name of ["resources", "documents"])
        await rm(join(transfer, name), { recursive: true, force: true });
      await rm(join(transfer, "manifest.json"), { force: true });
      succeeded = true;
      return { result: { discarded: true, transferId: request.transferId }, artifacts };
    }
    const manifest = (await json(
      transfer,
      ["manifest.json"],
      EDITOR_TASK_LIMITS.documentBytes + 2 * 1024 * 1024,
    )) as Manifest;
    record(manifest, ["kind", "documentHash", "sequenceId", "document", "bindings"], "工程快照");
    if (manifest.kind !== undefined && manifest.kind !== "project")
      throw new EditorTaskError("SNAPSHOT_MISMATCH", "工程快照类型无效");
    if ((manifest.kind === "project") !== (request.action === "export-project"))
      throw new EditorTaskError("SNAPSHOT_MISMATCH", "完整工程包需要独立的完整工程快照");
    if (
      manifest.documentHash !== request.documentHash ||
      manifest.sequenceId !== request.sequenceId
    )
      throw new EditorTaskError("SNAPSHOT_MISMATCH", "请求与已提交工程快照不一致");
    const selected =
      manifest.kind === "project"
        ? editorProjectDocument(manifest.document)
        : editorTaskDocument(manifest.document, manifest.sequenceId);
    if (bytesHash(Buffer.from(JSON.stringify(selected.document))) !== request.documentHash)
      throw new EditorTaskError("SNAPSHOT_MISMATCH", "保存的工程快照内容已变化");
    if (
      !Array.isArray(manifest.bindings) ||
      manifest.bindings.length !== selected.resourceIds.length
    )
      throw new EditorTaskError("INCOMPLETE_STAGE", "工程素材绑定不完整");
    const byResource = new Map<string, { binding: Binding; path: string }>();
    for (const binding of manifest.bindings) {
      if (!selected.resourceIds.includes(binding.resourceId) || byResource.has(binding.resourceId))
        throw new EditorTaskError("INCOMPLETE_STAGE", "工程素材绑定存在无效项");
      byResource.set(binding.resourceId, { binding, path: await material(binding) });
    }
    const installedNarration = selected.document.assets.some(isEditorDemoNarration)
      ? await builtin()
      : undefined;
    const original = (assetId: string) => {
      const asset = selected.document.assets.find((item) => item.id === assetId),
        value = asset && byResource.get(asset.resourceId ?? asset.id);
      if (asset && isEditorDemoNarration(asset) && installedNarration) return installedNarration;
      if (!value) throw new EditorTaskError("INCOMPLETE_STAGE", "当前工程缺少已授权的素材");
      return value;
    };
    if (request.action === "analyze-asset-waveform") {
      const assetId = request.assetIds![0]!,
        asset = selected.document.assets.find((item) => item.id === assetId);
      if (!asset || !["video", "audio"].includes(asset.kind))
        throw new EditorTaskError("INVALID_REQUEST", "请从当前序列选择一个声音或视频素材");
      const annotation = selected.document.production?.waveformAnalysisOrigin;
      let origin: {
        documentId: string;
        revision: number;
        sequenceId: string;
        assetId: string;
        documentHash: string;
      };
      if (annotation !== undefined) {
        const value = record(
          annotation,
          ["documentId", "revision", "sequenceId", "assetId", "documentHash"],
          "波形分析来源",
        );
        if (
          !["documentId", "sequenceId", "assetId"].every(
            (key) =>
              typeof value[key] === "string" && value[key].length > 0 && value[key].length <= 128,
          ) ||
          !Number.isSafeInteger(value.revision) ||
          value.revision < 0 ||
          value.assetId !== assetId ||
          !isEditorDemoNarration(asset) ||
          selected.document.assets.length !== 1 ||
          selected.document.sequences.length !== 1 ||
          selected.document.id === value.documentId
        )
          throw new EditorTaskError("SNAPSHOT_MISMATCH", "波形分析来源与只读分析快照不一致");
        origin = {
          documentId: value.documentId,
          revision: value.revision,
          sequenceId: value.sequenceId,
          assetId: value.assetId,
          documentHash: hash(value.documentHash),
        };
        if (selected.document.id !== `waveform-analysis-${digest(origin)}`)
          throw new EditorTaskError("SNAPSHOT_MISMATCH", "波形分析快照编号与来源不匹配");
      } else
        origin = {
          documentId: selected.document.id,
          revision: selected.document.revision,
          sequenceId: selected.document.activeSequenceId,
          assetId,
          documentHash: request.documentHash!,
        };
      const input = original(assetId);
      await progress(0, "analyze-waveform");
      const analysis = await analyzeEditorWaveform({
        input: input.path,
        sourceDuration: asset.duration,
        cacheDir: await directory(cache, ["waveforms"]),
        pcmCacheDir: await directory(cache, ["pcm"]),
        ffmpegPath: context.tools?.ffmpegPath ?? "ffmpeg",
        ffprobePath: context.tools?.ffprobePath ?? "ffprobe",
        signal: context.signal,
      });
      if (analysis.sourceHash !== input.binding.sha256)
        throw new EditorTaskError("SOURCE_CHANGED", "工程声音素材内容发生变化");
      const waveform = await add(analysis.path, "json", "application/json", "editor-waveform");
      await progress(1, "complete");
      succeeded = true;
      return {
        result: {
          documentHash: request.documentHash,
          sequenceId: request.sequenceId,
          assetId,
          origin,
          resourceId: input.binding.resourceId,
          sourceHash: analysis.sourceHash,
          recipeHash: analysis.recipeHash,
          waveform,
          reused: analysis.reused,
          reusedPcm: analysis.reusedPcm,
        },
        artifacts,
      };
    }
    if (request.action === "export-project") {
      let progressFailure: unknown;
      const packed = await exportPortableProject({
        document: selected.document,
        workDir: work,
        sourceRoots: [resources],
        outputPath: join(work, "project.mimiproject"),
        signal: context.signal,
        resolveAsset: async (asset) => {
          const source = original(asset.id);
          return { path: source.path, bytes: source.binding.bytes, sha256: source.binding.sha256 };
        },
        onProgress: (item) => {
          void progress(
            (item.phase === "checking" ? 0 : 0.45) +
              (item.total ? item.completed / item.total : 1) * 0.45,
            `bundle-${item.phase}`,
          ).catch((error) => {
            progressFailure ??= error;
          });
        },
      }).catch(portableTaskError);
      if (progressFailure) throw progressFailure;
      const bundle = await add(packed.path, "mimiproject", "application/zip", "portable-project");
      if (bundle.sha256 !== packed.sha256)
        throw new EditorTaskError("SOURCE_CHANGED", "工程包发布校验失败");
      await progress(1, "complete");
      succeeded = true;
      return {
        result: {
          documentHash: manifest.documentHash,
          bundle,
          mediaCount: packed.manifest.media.length,
          formatVersion: 1,
        },
        artifacts,
      };
    }
    const ffmpegPath = context.tools?.ffmpegPath ?? "ffmpeg",
      ffprobePath = context.tools?.ffprobePath ?? "ffprobe";
    const ffmpegVersion = (
      await runMediaProcess(ffmpegPath, ["-hide_banner", "-version"], { signal: context.signal })
    ).stdout.toString();
    const proxyContext = {
      ffmpegPath,
      ffprobePath,
      ffmpegVersion,
      cacheDir: cache,
      workDir: work,
      signal: context.signal,
    };
    const videos = new Map<string, EditorProxy>();
    const video = async (
      assetId: string,
      requireGeometry: boolean,
      purpose: "export" | "preview" = "export",
    ) => {
      const asset = selected.document.assets.find((item) => item.id === assetId);
      if (asset?.kind !== "video")
        throw new EditorTaskError("INVALID_REQUEST", "请仅选择视频素材准备兼容画面");
      const input = original(assetId),
        proxy = await prepareEditorProxy(input.path, input.binding.sha256, proxyContext, purpose);
      if (requireGeometry && (asset.width !== proxy.width || asset.height !== proxy.height))
        throw new EditorTaskError(
          "SOURCE_GEOMETRY_MISMATCH",
          `素材「${asset.name}」的显示尺寸与旋转或像素比例不一致，请先更新素材显示尺寸`,
        );
      videos.set(assetId, proxy);
      return proxy;
    };
    if (request.action === "prepare-video") {
      const sources: any[] = [];
      for (let index = 0; index < request.assetIds!.length; index++) {
        const assetId = request.assetIds![index]!,
          proxy = await video(assetId, false, "preview"),
          { path: _path, ...recipe } = proxy;
        const asset = await add(proxy.path, "mp4", "video/mp4", "editor-video-source");
        sources.push({ assetId, proxy: asset, recipe });
        await progress((index + 1) / request.assetIds!.length, "prepare-video");
      }
      succeeded = true;
      return {
        result: { documentHash: request.documentHash, sequenceId: request.sequenceId, sources },
        artifacts,
      };
    }
    const recipeHash = digest({
      recipe: "editor-audio-v2-timestamps",
      builtinNarration: installedNarration?.binding,
      documentHash: manifest.documentHash,
      sequenceId: manifest.sequenceId,
      bindings: manifest.bindings,
      ffmpegVersion,
    });
    const mixes = await directory(cache, ["mixes", recipeHash]);
    let mix = (await optionalJson(mixes, ["receipt.json"])) as MixReceipt | undefined;
    const expected = request.preparedAudio;
    if (
      expected &&
      (expected.recipeHash !== recipeHash ||
        expected.documentHash !== manifest.documentHash ||
        expected.sequenceId !== manifest.sequenceId)
    )
      throw new EditorTaskError("MIX_MISMATCH", "声音处理配方或源素材已变化，请重新准备声音");
    if (expected && !mix)
      throw new EditorTaskError("MIX_UNAVAILABLE", "已准备声音缓存已释放，请重新准备声音");
    let reused = Boolean(mix);
    if (mix) {
      if (
        mix.recipeHash !== recipeHash ||
        mix.documentHash !== manifest.documentHash ||
        mix.sequenceId !== manifest.sequenceId ||
        (expected && expected.assetId !== mix.assetId)
      )
        throw new EditorTaskError("MIX_MISMATCH", "已准备声音回执不匹配");
      const audioPath = await regular(mixes, ["audio.wav"]);
      if (
        `asset-${await fileHash(audioPath, context.signal)}` !== mix.assetId ||
        (await fileHash(await regular(mixes, ["report.json"]), context.signal)) !== mix.reportHash
      )
        throw new EditorTaskError("CACHE_CHANGED", "已准备声音内容校验失败");
    } else {
      const rendered = await renderEditorAudio({
        document: selected.document,
        sequenceId: manifest.sequenceId,
        resolveAssetPath: async (id) => original(id).path,
        ffmpegPath,
        ffprobePath,
        workDir: work,
        cacheDir: await directory(cache, ["pcm"]),
        outputPath: join(work, "mix.wav"),
        signal: context.signal,
        onProgress: (item) =>
          progress(
            request.action === "render" ? item.fraction * 0.25 : item.fraction * 0.9,
            "prepare-audio",
          ),
      });
      const { path: _path, ...details } = rendered;
      const reportBytes = Buffer.from(JSON.stringify(details));
      const assetId = `asset-${await fileHash(rendered.path, context.signal)}`;
      await rename(rendered.path, join(mixes, "audio.wav"));
      await atomic(join(mixes, "report.json"), reportBytes);
      mix = {
        documentHash: manifest.documentHash,
        sequenceId: manifest.sequenceId,
        recipeHash,
        assetId,
        sampleCount: rendered.sampleCount,
        peak: rendered.peak,
        samplesOverFullScale: rendered.samplesOverFullScale,
        reportHash: bytesHash(reportBytes),
      };
      await atomic(join(mixes, "receipt.json"), Buffer.from(JSON.stringify(mix)));
    }
    const preparedAudio: PreparedEditorAudio = {
      documentHash: mix.documentHash,
      sequenceId: mix.sequenceId,
      recipeHash: mix.recipeHash,
      assetId: mix.assetId,
    };
    const audio = await add(
      await regular(mixes, ["audio.wav"]),
      "wav",
      "audio/wav",
      "editor-preview-audio",
    );
    if (request.action === "prepare-audio") {
      const details = await add(
        await regular(mixes, ["report.json"]),
        "json",
        "application/json",
        "editor-audio-report",
      );
      await progress(1, "complete");
      succeeded = true;
      return {
        result: {
          preparedAudio,
          audio,
          report: details,
          sampleCount: mix.sampleCount,
          peak: mix.peak,
          samplesOverFullScale: mix.samplesOverFullScale,
          reused,
        },
        artifacts,
      };
    }
    if (bytesHash(Buffer.from(context.runtimeSource)) !== context.runtimeSha)
      throw new EditorTaskError("RUNTIME_CHANGED", "安装的渲染运行代码校验失败");
    const mediaFiles = new Map<string, { path: string; mimeType: string }>();
    for (let index = 0; index < selected.document.assets.length; index++) {
      const asset = selected.document.assets[index]!;
      if (asset.kind === "video") {
        const proxy = await video(asset.id, true);
        mediaFiles.set(asset.id, { path: proxy.path, mimeType: proxy.mimeType });
      } else if (asset.kind === "image") {
        const input = original(asset.id),
          magic = await readPrefix(resources, [`${input.binding.resourceId}.bin`]);
        const mimeType = magic.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? "image/png"
          : magic[0] === 255 && magic[1] === 216
            ? "image/jpeg"
            : magic.subarray(0, 3).toString() === "GIF"
              ? "image/gif"
              : magic.subarray(8, 12).toString() === "WEBP"
                ? "image/webp"
                : magic.subarray(4, 12).toString().includes("ftypavif")
                  ? "image/avif"
                  : undefined;
        if (!mimeType)
          throw new EditorTaskError(
            "UNSUPPORTED_IMAGE",
            "此图片格式尚不能用于共享浏览器合成，请转换为 PNG 或 JPEG",
          );
        mediaFiles.set(asset.id, { path: input.path, mimeType });
      }
      await progress(
        0.25 + ((index + 1) / Math.max(1, selected.document.assets.length)) * 0.15,
        "prepare-video",
      );
    }
    const outputPath = join(work, `video.${request.profile!.container}`);
    const output = await exportEditorSequence({
      document: selected.document,
      sequenceId: manifest.sequenceId,
      profile: request.profile!,
      mediaFiles,
      runtimeSource: context.runtimeSource,
      workDir: work,
      audioFile: await regular(mixes, ["audio.wav"]),
      outputPath,
      ffmpegPath,
      ffprobePath,
      signal: context.signal,
      browserPath: context.tools?.browserPath,
      onProgress: (item) =>
        progress(
          item.phase === "verify"
            ? 0.98
            : 0.4 + (item.completedFrames / Math.max(1, item.totalFrames)) * 0.55,
          item.phase === "verify" ? "verify-video" : "render-video",
        ),
    });
    const mimeType =
      request.profile!.container === "webm"
        ? "video/webm"
        : request.profile!.container === "mov"
          ? "video/quicktime"
          : "video/mp4";
    const exported = await add(output.path, request.profile!.container, mimeType, "editor-video");
    const details = await report({
      documentHash: manifest.documentHash,
      sequenceId: manifest.sequenceId,
      preparedAudio,
      runtimeSha: context.runtimeSha,
      profile: request.profile,
      frameCount: output.frameCount,
      durationSeconds: output.durationSeconds,
      proxies: [...videos].map(([assetId, proxy]) => {
        const { path: _path, ...value } = proxy;
        return { assetId, ...value };
      }),
    });
    await progress(1, "complete");
    succeeded = true;
    return {
      result: {
        video: exported,
        audio,
        preparedAudio,
        reusedAudio: reused,
        report: details,
        frameCount: output.frameCount,
        durationSeconds: output.durationSeconds,
        verified: true,
      },
      artifacts,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
    if (!succeeded) await rm(join(root, "outputs"), { recursive: true, force: true });
  }
}
