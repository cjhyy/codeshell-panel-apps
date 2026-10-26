import { normalizeNativeTextSupplement, copyNativeTextEnvelope } from "./native-text-import.mjs";
import { normalizeNativeNotesSupplement, validateNativeNotesSource } from "./native-notes.mjs";
import { assertCompleteConversionReports } from "./conversion-report.mjs";
import { assertCompleteNativeExportReport } from "./native-export-report.mjs";
/* Local asset tables for the Figma bridge. Binary bytes never enter the design schema. */
import { createDesignResourcePersistencePlan, MAX_DESIGN_RESOURCES } from "./resource-store.mjs";
import { imageMimeFromBytes } from "./image-mime.mjs";

export const MAX_FIGMA_ASSET_BYTES = 8 * 1024 * 1024;
export const MAX_FIGMA_ASSET_TOTAL_BYTES = 12 * 1024 * 1024;
export const MAX_FIGMA_SOURCE_BYTES = 16 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;
const MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function decodeFigmaAsset(base64) {
  if (
    typeof base64 !== "string" ||
    !base64.length ||
    base64.length % 4 !== 0 ||
    base64.length > Math.ceil(MAX_FIGMA_ASSET_BYTES / 3) * 4 ||
    !BASE64.test(base64)
  )
    throw new Error("Figma 图片必须是最多 8 MiB 的规范 Base64。");
  const binary = globalThis.atob(base64);
  if (binary.length > MAX_FIGMA_ASSET_BYTES) throw new Error("Figma 单张图片超过 8 MiB。");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function normalizeFigmaAsset(value) {
  const match =
    typeof value === "string"
      ? /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/iu.exec(value)
      : null;
  const mime = (match?.[1] ?? value?.mime ?? value?.descriptor?.mime)?.toLowerCase();
  const base64 = match?.[2] ?? value?.base64;
  if (!MIMES.has(mime)) throw new Error("Figma 图片 MIME 类型不受支持。");
  const bytes = decodeFigmaAsset(base64);
  if (imageMimeFromBytes(bytes) !== mime) throw new Error("Figma 图片字节与 MIME 类型不一致。");
  return { mime, base64, bytes };
}

/** Preserve all raw official Figma fields in a bounded, serializable source envelope. */
export function normalizeFigmaSource(input) {
  let value;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > MAX_FIGMA_SOURCE_BYTES)
      throw new Error("Figma JSON 最多 16 MiB；请分页面导出。");
    try {
      value = JSON.parse(input);
    } catch {
      throw new Error("Figma JSON 无法解析。");
    }
  } else {
    let content;
    assertCompleteConversionReports(input);
    assertCompleteNativeExportReport(input);
    try {
      // A source carrying native observations must not execute a toJSON or
      // accessor hook before its complete16MiB budget is measured.
      content = JSON.stringify(Object.hasOwn(input ?? {}, "nativeTextRanges") || Object.hasOwn(input ?? {}, "nativeNotes")
        ? copyNativeTextEnvelope(input) : input);
    } catch {
      throw new Error("Figma JSON 包含循环或不可序列化数据。");
    }
    if (
      typeof content !== "string" ||
      new TextEncoder().encode(content).byteLength > MAX_FIGMA_SOURCE_BYTES
    )
      throw new Error("Figma JSON 最多 16 MiB；请分页面导出。");
    value = JSON.parse(content);
  }
  if (!object(value)) throw new Error("Figma 来源必须是 JSON 对象。");
  assertCompleteConversionReports(value);
  assertCompleteNativeExportReport(value);
  if (
    value.format !== undefined &&
    (value.format !== "codeshell.figma.source" || value.version !== 1)
  )
    throw new Error("不支持的 Figma 来源格式。");
  const root = object(value.document)
    ? value.document
    : typeof value.type === "string"
      ? value
      : null;
  const nodes = object(value.nodes)
    ? value.nodes
    : root
      ? { [root.id ?? "root"]: object(value.document) ? value : { document: root } }
      : null;
  if (
    !nodes ||
    !Object.keys(nodes).length ||
    Object.keys(nodes).length > 10000 ||
    Object.values(nodes).some((entry) => !object(entry?.document))
  )
    throw new Error("Figma 来源没有有效的官方 document 图层。");
  let nodeCount = 0;
  const inspect = (node, depth) => {
    if (!object(node) || depth > 34 || ++nodeCount > 50000)
      throw new Error("Figma 来源图层无效、过深或超过 50,000 图层。");
    if (node.children !== undefined && !Array.isArray(node.children))
      throw new Error("Figma 来源 children 无效。");
    for (const child of node.children ?? []) inspect(child, depth + 1);
  };
  for (const entry of Object.values(nodes)) inspect(entry.document, 0);
  const assets = value.assets ?? {},
    previews = value.previews ?? {};
  if (
    !object(assets) ||
    !object(previews) ||
    Object.keys(assets).length > MAX_DESIGN_RESOURCES ||
    Object.keys(previews).length > 10000
  )
    throw new Error("Figma 图片或预览表无效。");
  for (const [id, preview] of Object.entries(previews)) {
    if (
      !id ||
      id.length > 160 ||
      !object(preview) ||
      typeof preview.assetId !== "string" ||
      !Object.hasOwn(assets, preview.assetId)
    )
      throw new Error("Figma 预览没有可用的本地资源。");
    if (
      preview.bounds !== undefined &&
      (!object(preview.bounds) ||
        !["x", "y", "width", "height"].every((key) => Number.isFinite(preview.bounds[key])) ||
        preview.bounds.width <= 0 ||
        preview.bounds.height <= 0)
    )
      throw new Error("Figma 预览边界无效。");
  }
  if (value.selection !== undefined) {
    const selection = value.selection,
      matrix = (value) =>
        Array.isArray(value) &&
        value.length === 2 &&
        value.every((row) => Array.isArray(row) && row.length === 3 && row.every(Number.isFinite));
    if (
      !object(selection) ||
      typeof selection.pageId !== "string" ||
      !selection.pageId.length ||
      selection.pageId.length > 160 ||
      typeof selection.pageName !== "string" ||
      !object(selection.roots) ||
      Object.keys(selection.roots).length > 10000
    )
      throw new Error("Figma 选区来源上下文无效。");
    for (const [id, context] of Object.entries(selection.roots))
      if (
        !object(context) ||
        !object(nodes[id]?.document) ||
        typeof context.parentId !== "string" ||
        context.parentId.length > 160 ||
        !matrix(context.parentTransform) ||
        !matrix(context.absoluteTransform) ||
        !Number.isFinite(context.width) ||
        !Number.isFinite(context.height) ||
        context.width <= 0 ||
        context.height <= 0
      )
        throw new Error("Figma 选区父级变换无效。");
  }
  const nativeTextRanges = normalizeNativeTextSupplement(value.nativeTextRanges);
  const nativeNotes = normalizeNativeNotesSupplement(value.nativeNotes);
  validateNativeNotesSource(nativeNotes, Object.values(nodes).map(entry => entry.document));
  return {
    format: "codeshell.figma.source",
    version: 1,
    name: typeof value.name === "string" ? value.name : (root?.name ?? "Figma Import"),
    ...(typeof value.fileKey === "string" ? { fileKey: value.fileKey.slice(0, 256) } : {}),
    nodes,
    ...(Object.hasOwn(value, "conversionReport") ? { conversionReport: value.conversionReport } : {}),
    ...(Object.hasOwn(value, "exportReport") ? { exportReport: value.exportReport } : {}),
    assets,
    previews,
    ...(nativeTextRanges ? { nativeTextRanges } : {}),
    ...(nativeNotes ? { nativeNotes } : {}),
    ...(value.selection ? { selection: value.selection } : {}),
    ...(Array.isArray(value.warnings)
      ? { warnings: value.warnings.slice(0, 200).map((warning) => String(warning).slice(0, 2000)) }
      : {}),
  };
}

export async function prepareFigmaAssets(source, { sha256Bytes } = {}) {
  const resources = [],
    resourcePlans = [],
    byAssetId = new Map(),
    byDigest = new Map();
  let totalBytes = 0;
  for (const [assetId, value] of Object.entries(source.assets)) {
    if (!assetId || assetId.length > 160) throw new Error("Figma 图片 ID 无效。");
    const asset = normalizeFigmaAsset(value);
    totalBytes += asset.bytes.byteLength;
    if (totalBytes > MAX_FIGMA_ASSET_TOTAL_BYTES)
      throw new Error("Figma 图片总量超过 12 MiB；请分页面导出。");
    if (typeof sha256Bytes !== "function") throw new Error("导入 Figma 图片需要 SHA-256 能力。");
    const digest = await sha256Bytes(asset.bytes);
    if (!/^[a-f0-9]{64}$/u.test(digest)) throw new Error("Figma 图片 SHA-256 无效。");
    let plan = byDigest.get(digest);
    if (!plan) {
      plan = await createDesignResourcePersistencePlan({
        id: `figma-image-${digest.slice(0, 40)}`,
        kind: "image",
        mime: asset.mime,
        base64: asset.base64,
        sha256Bytes,
      });
      byDigest.set(digest, plan);
      resources.push(plan.descriptor);
      resourcePlans.push(plan);
    }
    byAssetId.set(assetId, plan.descriptor.id);
  }
  return { resources, resourcePlans, byAssetId, totalBytes };
}

export function createFigmaTransferAssets(document, resources = new Map()) {
  const assets = {},
    lookup = resources instanceof Map ? resources : new Map(Object.entries(resources ?? {}));
  const referenced = new Set();
  const visit = (nodes) => {
    for (const node of nodes) {
      if (node.imageRef) referenced.add(node.imageRef);
      visit(node.children ?? []);
    }
  };
  for (const page of document.pages) visit(page.children ?? page.nodes ?? []);
  if (Array.isArray(document.nodes)) visit(document.nodes);
  let totalBytes = 0;
  for (const id of referenced) {
    if (!lookup.has(id)) throw new Error(`Figma 导出缺少图片资源：${id}`);
    const asset = normalizeFigmaAsset(lookup.get(id));
    totalBytes += asset.bytes.length;
    if (totalBytes > MAX_FIGMA_ASSET_TOTAL_BYTES)
      throw new Error("Figma 图片总量超过 12 MiB；请分页面导出。");
    const descriptor = document.resources.find(
      (entry) => entry.id === id && entry.kind === "image",
    );
    if (!descriptor || descriptor.bytes !== asset.bytes.length || descriptor.mime !== asset.mime)
      throw new Error(`Figma 导出图片与文档描述不符：${id}`);
    assets[id] = { mime: asset.mime, base64: asset.base64 };
  }
  return assets;
}
