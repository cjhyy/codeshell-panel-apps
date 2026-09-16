import { rm, stat, open, link } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { importPortableProject } from "./bundle.js";
import {
  validatePortableProjectManifest,
  PortableProjectError,
  type PortableProjectManifest,
} from "../../src/editor/portable-project.js";
import {
  abort,
  atomic,
  bytesHash,
  directory,
  fileHash,
  optionalJson,
  readBytes,
  regular,
} from "./files.js";
import { EditorTaskError, hash, resourceId, type EditorRequest } from "./protocol.js";
import type { EditorTaskArtifact } from "../../src/editor/task-bridge.js";

export const PORTABLE_PUBLICATION_BATCH = 120;
interface ImportReceipt {
  schemaVersion: 1;
  bundleHash: string;
  sourceResourceId: string;
  directory: string;
  manifestHash: string;
  manifestBytes: number;
  mediaCount: number;
  pages: Array<{ sha256: string; bytes: number }>;
}
interface Context {
  root: string;
  transfer: string;
  signal: AbortSignal;
  add(path: string, extension: string, mimeType: string, role: string): Promise<EditorTaskArtifact>;
  progress(fraction: number, stage: string, message?: string): Promise<void>;
}
function checkedReceipt(value: unknown): ImportReceipt {
  const receipt = value as ImportReceipt;
  if (
    !receipt ||
    receipt.schemaVersion !== 1 ||
    !/^bundle-import-[a-f0-9-]{36}$/.test(receipt.directory) ||
    !Number.isSafeInteger(receipt.manifestBytes) ||
    receipt.manifestBytes < 1 ||
    receipt.manifestBytes > 32 * 1024 ** 2
  )
    throw new EditorTaskError("IMPORT_RECEIPT_INVALID", "工程包暂存回执无效，请重新导入");
  hash(receipt.bundleHash);
  hash(receipt.manifestHash);
  resourceId(receipt.sourceResourceId);
  if (
    !Number.isSafeInteger(receipt.mediaCount) ||
    receipt.mediaCount < 0 ||
    receipt.mediaCount > 10000 ||
    !Array.isArray(receipt.pages) ||
    receipt.pages.length !== Math.ceil(receipt.mediaCount / PORTABLE_PUBLICATION_BATCH)
  )
    throw new EditorTaskError("IMPORT_RECEIPT_INVALID", "工程包批次回执无效");
  for (const page of receipt.pages) {
    hash(page.sha256);
    if (!Number.isSafeInteger(page.bytes) || page.bytes < 1 || page.bytes > 128 * 1024)
      throw new EditorTaskError("IMPORT_RECEIPT_INVALID", "工程包批次大小无效");
  }
  return receipt;
}
async function loadManifest(
  base: string,
  receipt: ImportReceipt,
): Promise<PortableProjectManifest> {
  const data = await readBytes(base, [receipt.directory, "manifest.json"], 32 * 1024 ** 2);
  if (data.length !== receipt.manifestBytes || bytesHash(data) !== receipt.manifestHash)
    throw new EditorTaskError("IMPORT_RECEIPT_INVALID", "工程包暂存清单已变化，请重新导入");
  return validatePortableProjectManifest(
    JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(data)),
  );
}
function mediaMime(manifest: PortableProjectManifest, assetIds: string[]): string {
  const types = new Set(
    assetIds.map((id) => {
      const asset = manifest.document.assets.find((asset) => asset.id === id);
      const mime = asset?.metadata?.mimeType ?? asset?.metadata?.sourceMimeType;
      return typeof mime === "string" && /^(?:image|audio|video)\/[A-Za-z0-9!#$&^_.+-]+$/.test(mime)
        ? mime
        : "application/octet-stream";
    }),
  );
  return types.size === 1 ? [...types][0]! : "application/octet-stream";
}

/** Scope-local immutable import receipts. Pages publish only verified original bytes, at most 120 per task. */
export async function runPortableImportRequest(
  request: EditorRequest,
  context: Context,
): Promise<unknown> {
  const base = await directory(context.transfer, ["portable-import"]);
  const discarded = await optionalJson(base, ["discarded.json"]);
  if (discarded) {
    if (request.action === "discard-project-import" && discarded.bundleHash === request.bundleHash)
      return { discarded: true, transferId: request.transferId, bundleHash: request.bundleHash };
    throw new EditorTaskError("IMPORT_DISCARDED", "此工程包暂存已释放，请开始新的导入");
  }
  let receipt = (await optionalJson(base, ["receipt.json"])) as ImportReceipt | undefined;
  if (request.action === "import-project") {
    const sourceResourceId = request.resourceIds![0]!;
    if (receipt) {
      receipt = checkedReceipt(receipt);
      if (receipt.sourceResourceId !== sourceResourceId)
        throw new EditorTaskError("IMPORT_MISMATCH", "同一导入暂存不能改用另一个工程包");
    } else {
      const input = await regular(context.root, ["inputs", "resource-0.bin"]);
      const before = await stat(input),
        bundleHash = await fileHash(input, context.signal);
      if (sourceResourceId.startsWith("asset-") && sourceResourceId !== `asset-${bundleHash}`)
        throw new EditorTaskError("SOURCE_CHANGED", "工程包内容与资源编号不匹配");
      let progressFailure: unknown;
      const imported = await importPortableProject({
        inputPath: input,
        sourceRoots: [context.root],
        workDir: base,
        signal: context.signal,
        onProgress: (item) => {
          void context
            .progress(item.total ? (item.completed / item.total) * 0.9 : 0.9, "import-project")
            .catch((error) => {
              progressFailure ??= error;
            });
        },
      });
      let published = false;
      try {
        if (progressFailure) throw progressFailure;
        const after = await stat(input);
        if (
          before.dev !== after.dev ||
          before.ino !== after.ino ||
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs
        )
          throw new EditorTaskError("SOURCE_CHANGED", "工程包在读取时发生变化，请重新导入");
        const bytes = Buffer.from(JSON.stringify(imported.manifest));
        const pages = [];
        for (
          let index = 0;
          index < imported.manifest.media.length;
          index += PORTABLE_PUBLICATION_BATCH
        ) {
          const items = imported.manifest.media
            .slice(index, index + PORTABLE_PUBLICATION_BATCH)
            .map((item) => ({
              sha256: item.sha256,
              bytes: item.bytes,
              mimeType: mediaMime(imported.manifest, item.assetIds),
            }));
          const data = Buffer.from(JSON.stringify(items));
          await atomic(join(imported.directory, `page-${pages.length}.json`), data);
          pages.push({ sha256: bytesHash(data), bytes: data.length });
        }
        receipt = {
          schemaVersion: 1,
          bundleHash,
          sourceResourceId,
          directory: basename(imported.directory),
          manifestHash: bytesHash(bytes),
          manifestBytes: bytes.length,
          mediaCount: imported.manifest.media.length,
          pages,
        };
        await atomic(join(imported.directory, "manifest.json"), bytes);
        abort(context.signal);
        // Exclusive receipt publication prevents a competing different import from replacing this snapshot.
        const temporary = join(base, `receipt-${randomUUID()}.tmp`),
          file = await open(temporary, "wx", 0o600);
        try {
          await file.writeFile(JSON.stringify(receipt));
          await file.sync();
        } finally {
          await file.close();
        }
        try {
          await link(temporary, join(base, "receipt.json"));
          published = true;
        } finally {
          await rm(temporary, { force: true });
        }
      } finally {
        if (!published) await rm(imported.directory, { recursive: true, force: true });
      }
    }
  }
  if (!receipt)
    throw new EditorTaskError("IMPORT_NOT_READY", "工程包尚未完整校验，请先导入原始工程包");
  receipt = checkedReceipt(receipt);
  if (request.bundleHash && request.bundleHash !== receipt.bundleHash)
    throw new EditorTaskError("IMPORT_MISMATCH", "请求与已校验的工程包不一致");
  if (request.action === "discard-project-import") {
    await atomic(
      join(base, "discarded.json"),
      Buffer.from(JSON.stringify({ bundleHash: receipt.bundleHash })),
    );
    await rm(join(base, receipt.directory), { recursive: true, force: true });
    await rm(join(base, "receipt.json"), { force: true });
    return { discarded: true, transferId: request.transferId, bundleHash: receipt.bundleHash };
  }
  if (request.action === "publish-project-media") {
    const page = receipt.pages[request.batchIndex!];
    if (!page) throw new EditorTaskError("INVALID_REQUEST", "工程包素材批次不存在");
    const data = await readBytes(
      base,
      [receipt.directory, `page-${request.batchIndex}.json`],
      128 * 1024,
    );
    if (data.length !== page.bytes || bytesHash(data) !== page.sha256)
      throw new EditorTaskError("IMPORT_RECEIPT_INVALID", "工程包素材批次回执已变化");
    const batch = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(data)) as Array<{
        sha256: string;
        bytes: number;
        mimeType: string;
      }>,
      media = [];
    if (
      !Array.isArray(batch) ||
      batch.length !==
        Math.min(
          PORTABLE_PUBLICATION_BATCH,
          receipt.mediaCount - request.batchIndex! * PORTABLE_PUBLICATION_BATCH,
        )
    )
      throw new EditorTaskError("IMPORT_RECEIPT_INVALID", "工程包素材批次不完整");
    for (const item of batch) {
      abort(context.signal);
      const path = await regular(base, [receipt.directory, "media", item.sha256]);
      if ((await stat(path)).size !== item.bytes)
        throw new EditorTaskError("SOURCE_CHANGED", "已校验的暂存素材发生变化，请重新导入");
      const artifact = await context.add(path, "bin", item.mimeType, "portable-media");
      if (artifact.sha256 !== item.sha256 || artifact.bytes !== item.bytes)
        throw new EditorTaskError("SOURCE_CHANGED", "发布素材时内容发生变化");
      media.push(artifact);
      await context.progress(media.length / batch.length, "publish-project-media");
    }
    return {
      transferId: request.transferId,
      bundleHash: receipt.bundleHash,
      batchIndex: request.batchIndex,
      media,
    };
  }
  await loadManifest(base, receipt);
  const artifact = await context.add(
    await regular(base, [receipt.directory, "manifest.json"]),
    "json",
    "application/json",
    "portable-manifest",
  );
  if (artifact.sha256 !== receipt.manifestHash)
    throw new EditorTaskError("IMPORT_RECEIPT_INVALID", "发布的工程清单校验失败");
  await context.progress(1, "complete");
  return {
    transferId: request.transferId,
    sourceResourceId: receipt.sourceResourceId,
    bundleHash: receipt.bundleHash,
    manifest: artifact,
    mediaCount: receipt.mediaCount,
  };
}

export function portableTaskError(error: unknown): never {
  if (error instanceof PortableProjectError) {
    const detail = error.issues
      .slice(0, 5)
      .map((issue) => issue.message.slice(0, 120))
      .join("；");
    throw new EditorTaskError(
      error.code,
      `${error.message}${detail ? `：${detail}${error.issues.length > 5 ? `；另有 ${error.issues.length - 5} 项` : ""}` : ""}`,
      false,
    );
  }
  throw error;
}
