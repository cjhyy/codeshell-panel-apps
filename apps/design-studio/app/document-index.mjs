import {
  MAX_DESIGN_NODES_PER_PAGE,
  MAX_DESIGN_PAGES,
  serializeDesignDocument,
} from "./document.mjs";
import {
  MAX_DESIGN_BUNDLE_PART_BYTES,
  MAX_WORKSPACE_DESIGN_TEXT_BYTES,
  splitDesignSource,
} from "./document-bundle.mjs";
import { normalizeDesignResources } from "./resource-store.mjs";

export const DESIGN_INDEX_FORMAT = "codeshell.design.index";
export const DESIGN_INDEX_VERSION = 3;
export const DEPENDENCY_CATALOG_INDEX_VERSION = 2;
export const LEGACY_DESIGN_INDEX_VERSION = 1;
export const DESIGN_PAGE_FORMAT = "codeshell.design.page";
export const DESIGN_PAGE_VERSION = 1;
export const MAX_INDEXED_PAGE_PARTS = 4_096;

const encoder = new TextEncoder();
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[a-z][a-z0-9-]{0,63}$/u;
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]+$/u;

function byteLength(value) {
  return encoder.encode(value).length;
}

function assertExactKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} 包含未知字段：${key}`);
  }
}

function assertSafeName(value, label) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 120 ||
    !SAFE_TEXT.test(value)
  ) {
    throw new Error(`${label}无效`);
  }
}

function pagePartPath(sha256, index) {
  return `designs/codesign-data/pages/${sha256.slice(0, 16)}/${sha256}-${String(index + 1).padStart(4, "0")}.txt`;
}

export function indexedPagePartPath(sha256, index) {
  if (typeof sha256 !== "string" || !SHA256.test(sha256)) {
    throw new Error("页面摘要无效");
  }
  if (!Number.isInteger(index) || index < 0 || index >= MAX_INDEXED_PAGE_PARTS) {
    throw new Error("页面分片序号无效");
  }
  return pagePartPath(sha256, index);
}

function normalizePageDescriptor(value, index, pageIds) {
  const dependencyKeys =
    value.componentIds === undefined && value.instanceComponentIds === undefined
      ? []
      : ["componentIds", "instanceComponentIds"];
  assertExactKeys(
    value,
    new Set([
      "id",
      "name",
      "nodeCount",
      "bytes",
      "sha256",
      "partCount",
      ...dependencyKeys,
    ]),
    `页面索引 ${index + 1}`,
  );
  if (
    typeof value.id !== "string" ||
    !SAFE_ID.test(value.id) ||
    pageIds.has(value.id)
  ) {
    throw new Error(`页面索引 ${index + 1} 的 ID 无效或重复`);
  }
  assertSafeName(value.name, `页面索引 ${index + 1} 的名称`);
  if (
    !Number.isInteger(value.nodeCount) ||
    value.nodeCount < 0 ||
    value.nodeCount > MAX_DESIGN_NODES_PER_PAGE
  ) {
    throw new Error(`页面索引 ${index + 1} 的图层数无效`);
  }
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 1) {
    throw new Error(`页面索引 ${index + 1} 的字节数无效`);
  }
  if (typeof value.sha256 !== "string" || !SHA256.test(value.sha256)) {
    throw new Error(`页面索引 ${index + 1} 的摘要无效`);
  }
  const minimumPartCount = Math.ceil(value.bytes / MAX_DESIGN_BUNDLE_PART_BYTES);
  if (
    !Number.isInteger(value.partCount) ||
    value.partCount < 1 ||
    value.partCount > MAX_INDEXED_PAGE_PARTS ||
    value.partCount < minimumPartCount ||
    value.partCount > minimumPartCount + 1
  ) {
    throw new Error(`页面索引 ${index + 1} 的分片数无效`);
  }
  const normalizeComponentIds = (ids, label) => {
    if (dependencyKeys.length === 0) return [];
    if (
      !Array.isArray(ids) ||
      ids.length > value.nodeCount ||
      ids.some(
        (id) =>
          typeof id !== "string" ||
          !id ||
          id.length > 160 ||
          /[\u0000-\u001f\u007f]/u.test(id),
      ) ||
      new Set(ids).size !== ids.length
    ) {
      throw new Error(`页面索引 ${index + 1} 的${label}无效`);
    }
    return [...ids].sort();
  };
  pageIds.add(value.id);
  return {
    id: value.id,
    name: value.name,
    nodeCount: value.nodeCount,
    bytes: value.bytes,
    sha256: value.sha256,
    partCount: value.partCount,
    componentIds: normalizeComponentIds(value.componentIds, "组件目录"),
    instanceComponentIds: normalizeComponentIds(
      value.instanceComponentIds,
      "实例依赖目录",
    ),
  };
}

export function normalizeDesignIndexManifest(value) {
  const resourceKeys = value.resources === undefined ? [] : ["resources"];
  assertExactKeys(
    value,
    new Set([
      "format",
      "indexVersion",
      "documentFormat",
      "documentVersion",
      "name",
      "canvas",
      "tokens",
      ...resourceKeys,
      "activePageId",
      "pages",
    ]),
    "设计索引",
  );
  if (
    value.format !== DESIGN_INDEX_FORMAT ||
    ![
      LEGACY_DESIGN_INDEX_VERSION,
      DEPENDENCY_CATALOG_INDEX_VERSION,
      DESIGN_INDEX_VERSION,
    ].includes(value.indexVersion)
  ) {
    throw new Error("设计索引格式或版本无效");
  }
  if (value.documentFormat !== "codeshell.design" || value.documentVersion !== 3) {
    throw new Error("设计索引必须引用 CodeShell Design v3");
  }
  assertSafeName(value.name, "设计索引名称");
  assertExactKeys(value.canvas, new Set(["width", "height", "background"]), "设计索引 canvas");
  if (
    typeof value.canvas.width !== "number" ||
    !Number.isFinite(value.canvas.width) ||
    value.canvas.width < 100 ||
    value.canvas.width > 10_000 ||
    typeof value.canvas.height !== "number" ||
    !Number.isFinite(value.canvas.height) ||
    value.canvas.height < 100 ||
    value.canvas.height > 10_000 ||
    typeof value.canvas.background !== "string" ||
    !/^#[0-9a-f]{6}$/iu.test(value.canvas.background)
  ) {
    throw new Error("设计索引 canvas 无效");
  }
  assertExactKeys(value.tokens, new Set(["colors"]), "设计索引 tokens");
  if (!Array.isArray(value.tokens.colors) || value.tokens.colors.length > 32) {
    throw new Error("设计索引颜色变量无效");
  }
  const colorNames = new Set();
  const colors = value.tokens.colors.map((token, index) => {
    assertExactKeys(token, new Set(["name", "value"]), `设计索引颜色变量 ${index + 1}`);
    if (
      typeof token.name !== "string" ||
      !token.name.trim() ||
      token.name.length > 80 ||
      !SAFE_TEXT.test(token.name) ||
      typeof token.value !== "string" ||
      !/^#[0-9a-f]{6}$/iu.test(token.value)
    ) {
      throw new Error(`设计索引颜色变量 ${index + 1} 无效`);
    }
    const normalizedName = token.name.trim().toLowerCase();
    if (colorNames.has(normalizedName)) {
      throw new Error(`设计索引颜色变量名称重复：${token.name}`);
    }
    colorNames.add(normalizedName);
    return { name: token.name, value: token.value.toLowerCase() };
  });
  if (
    !Array.isArray(value.pages) ||
    value.pages.length < 1 ||
    value.pages.length > MAX_DESIGN_PAGES
  ) {
    throw new Error(`设计索引必须包含 1–${MAX_DESIGN_PAGES} 个页面`);
  }
  const pageIds = new Set();
  const pages = value.pages.map((page, index) =>
    normalizePageDescriptor(page, index, pageIds),
  );
  if (typeof value.activePageId !== "string" || !pageIds.has(value.activePageId)) {
    throw new Error("设计索引 activePageId 必须引用一个存在的页面");
  }
  const manifest = {
    format: DESIGN_INDEX_FORMAT,
    indexVersion: value.indexVersion,
    documentFormat: "codeshell.design",
    documentVersion: 3,
    name: value.name,
    canvas: {
      width: value.canvas.width,
      height: value.canvas.height,
      background: value.canvas.background.toLowerCase(),
    },
    tokens: { colors },
    resources: normalizeDesignResources(value.resources ?? []),
    activePageId: value.activePageId,
    pages,
    dependencyCatalogComplete:
      value.indexVersion >= DEPENDENCY_CATALOG_INDEX_VERSION,
  };
  const canonicalManifest = {
    format: manifest.format,
    indexVersion: manifest.indexVersion,
    documentFormat: manifest.documentFormat,
    documentVersion: manifest.documentVersion,
    name: manifest.name,
    canvas: manifest.canvas,
    tokens: manifest.tokens,
    ...(manifest.indexVersion >= DESIGN_INDEX_VERSION
      ? { resources: manifest.resources }
      : {}),
    activePageId: manifest.activePageId,
    pages: manifest.pages.map((page) => ({
      id: page.id,
      name: page.name,
      nodeCount: page.nodeCount,
      bytes: page.bytes,
      sha256: page.sha256,
      partCount: page.partCount,
      ...(manifest.dependencyCatalogComplete
        ? {
            componentIds: page.componentIds,
            instanceComponentIds: page.instanceComponentIds,
          }
        : {}),
    })),
  };
  const source = `${JSON.stringify(canonicalManifest, null, 2)}\n`;
  if (byteLength(source) > MAX_WORKSPACE_DESIGN_TEXT_BYTES) {
    throw new Error("设计索引目录超过 Host 单文件预算；需要升级目录分页格式");
  }
  return manifest;
}

function persistentDesignIndexManifest(manifest) {
  return {
    format: manifest.format,
    indexVersion: manifest.indexVersion,
    documentFormat: manifest.documentFormat,
    documentVersion: manifest.documentVersion,
    name: manifest.name,
    canvas: manifest.canvas,
    tokens: manifest.tokens,
    ...(manifest.indexVersion >= DESIGN_INDEX_VERSION
      ? { resources: manifest.resources }
      : {}),
    activePageId: manifest.activePageId,
    pages: manifest.pages.map((page) => ({
      id: page.id,
      name: page.name,
      nodeCount: page.nodeCount,
      bytes: page.bytes,
      sha256: page.sha256,
      partCount: page.partCount,
      ...(manifest.dependencyCatalogComplete
        ? {
            componentIds: page.componentIds,
            instanceComponentIds: page.instanceComponentIds,
          }
        : {}),
    })),
  };
}

export function serializeDesignIndexManifest(manifest) {
  const source = `${JSON.stringify(persistentDesignIndexManifest(manifest), null, 2)}\n`;
  if (byteLength(source) > MAX_WORKSPACE_DESIGN_TEXT_BYTES) {
    throw new Error("设计索引目录超过 Host 单文件预算；需要升级目录分页格式");
  }
  return source;
}

function canonicalPageSource(page) {
  return `${JSON.stringify(
    {
      format: DESIGN_PAGE_FORMAT,
      version: DESIGN_PAGE_VERSION,
      id: page.id,
      name: page.name,
      children: page.children,
    },
    null,
    2,
  )}\n`;
}

function summarizePageNodes(children) {
  let count = 0;
  const componentIds = new Set();
  const instanceComponentIds = new Set();
  const pending = [...children];
  while (pending.length > 0) {
    const node = pending.pop();
    count += 1;
    if (count > MAX_DESIGN_NODES_PER_PAGE) {
      throw new Error(`页面最多包含 ${MAX_DESIGN_NODES_PER_PAGE} 个源图层`);
    }
    if (node?.type === "component" && typeof node.id === "string") {
      componentIds.add(node.id);
    }
    if (node?.type === "instance" && typeof node.componentId === "string") {
      instanceComponentIds.add(node.componentId);
    }
    if (Array.isArray(node?.children)) pending.push(...node.children);
  }
  return {
    nodeCount: count,
    componentIds: [...componentIds].sort(),
    instanceComponentIds: [...instanceComponentIds].sort(),
  };
}

export async function createDesignIndexPersistencePlan({
  document,
  sha256,
  previousManifest = null,
}) {
  if (typeof sha256 !== "function") throw new Error("设计索引需要 SHA-256 能力");
  const logicalSource = serializeDesignDocument(document);
  const repository = JSON.parse(logicalSource);
  const previous =
    previousManifest?.format === DESIGN_INDEX_FORMAT
      ? normalizeDesignIndexManifest(persistentDesignIndexManifest(previousManifest))
      : null;
  const previousPages = new Map((previous?.pages ?? []).map((page) => [page.id, page]));
  const pages = [];
  const parts = [];
  let indexedObjectBytes = 0;
  let changedPageCount = 0;
  for (const page of repository.pages) {
    const source = canonicalPageSource(page);
    const bytes = byteLength(source);
    const digest = await sha256(source);
    if (typeof digest !== "string" || !SHA256.test(digest)) {
      throw new Error(`页面 ${page.id} 的 SHA-256 摘要无效`);
    }
    const split = splitDesignSource(source);
    if (split.length > MAX_INDEXED_PAGE_PARTS) {
      throw new Error(`页面 ${page.id} 的单页操作预算过大；请拆分页面`);
    }
    const summary = summarizePageNodes(page.children);
    const descriptor = {
      id: page.id,
      name: page.name,
      nodeCount: summary.nodeCount,
      bytes,
      sha256: digest,
      partCount: split.length,
      componentIds: summary.componentIds,
      instanceComponentIds: summary.instanceComponentIds,
    };
    pages.push(descriptor);
    indexedObjectBytes += bytes;
    if (previousPages.get(page.id)?.sha256 === digest) continue;
    changedPageCount += 1;
    for (const [index, part] of split.entries()) {
      parts.push({
        path: pagePartPath(digest, index),
        bytes: part.bytes,
        content: part.content,
        pageId: page.id,
      });
    }
  }
  const manifest = normalizeDesignIndexManifest({
    format: DESIGN_INDEX_FORMAT,
    indexVersion: DESIGN_INDEX_VERSION,
    documentFormat: "codeshell.design",
    documentVersion: 3,
    name: repository.name,
    canvas: repository.canvas,
    tokens: repository.tokens,
    resources: repository.resources ?? [],
    activePageId: repository.activePageId,
    pages,
  });
  return {
    mode: "indexed",
    bytes: byteLength(logicalSource),
    indexedObjectBytes,
    primarySource: serializeDesignIndexManifest(manifest),
    manifest,
    parts,
    partCount: pages.reduce((sum, page) => sum + page.partCount, 0),
    changedPageCount,
  };
}

export async function createIncrementalDesignIndexPersistencePlan({
  document,
  pageRecords,
  sha256,
  previousManifest,
}) {
  if (typeof sha256 !== "function") throw new Error("设计索引需要 SHA-256 能力");
  if (!(pageRecords instanceof Map)) throw new Error("增量索引需要已加载页面记录");
  const previous =
    previousManifest?.format === DESIGN_INDEX_FORMAT
      ? normalizeDesignIndexManifest(persistentDesignIndexManifest(previousManifest))
      : null;
  if (!previous) throw new Error("增量索引保存缺少上一版页面目录");
  if (
    !document ||
    typeof document !== "object" ||
    !Array.isArray(document.pages) ||
    document.pages.length < 1 ||
    document.pages.length > MAX_DESIGN_PAGES
  ) {
    throw new Error("增量索引文档无效");
  }
  const previousPages = new Map(previous.pages.map((page) => [page.id, page]));
  const pages = [];
  const parts = [];
  let indexedObjectBytes = 0;
  let changedPageCount = 0;
  for (const pageMetadata of document.pages) {
    const record = pageRecords.get(pageMetadata.id);
    if (!record) {
      const descriptor = previousPages.get(pageMetadata.id);
      if (!descriptor) {
        throw new Error(`新页面 ${pageMetadata.id} 尚未加载，无法保存`);
      }
      if (descriptor.name !== pageMetadata.name) {
        throw new Error(`页面 ${pageMetadata.id} 改名后需要先加载再保存`);
      }
      pages.push(descriptor);
      indexedObjectBytes += descriptor.bytes;
      continue;
    }
    if (
      record.id !== pageMetadata.id ||
      record.name !== pageMetadata.name ||
      !Array.isArray(record.children)
    ) {
      throw new Error(`已加载页面 ${pageMetadata.id} 与页面目录不一致`);
    }
    const source = canonicalPageSource(record);
    const bytes = byteLength(source);
    const digest = await sha256(source);
    if (typeof digest !== "string" || !SHA256.test(digest)) {
      throw new Error(`页面 ${record.id} 的 SHA-256 摘要无效`);
    }
    const split = splitDesignSource(source);
    if (split.length > MAX_INDEXED_PAGE_PARTS) {
      throw new Error(`页面 ${record.id} 的单页操作预算过大；请拆分页面`);
    }
    const summary = summarizePageNodes(record.children);
    const descriptor = {
      id: record.id,
      name: record.name,
      nodeCount: summary.nodeCount,
      bytes,
      sha256: digest,
      partCount: split.length,
      componentIds: summary.componentIds,
      instanceComponentIds: summary.instanceComponentIds,
    };
    pages.push(descriptor);
    indexedObjectBytes += bytes;
    if (previousPages.get(record.id)?.sha256 === digest) continue;
    changedPageCount += 1;
    for (const [index, part] of split.entries()) {
      parts.push({
        path: pagePartPath(digest, index),
        bytes: part.bytes,
        content: part.content,
        pageId: record.id,
      });
    }
  }
  const manifest = normalizeDesignIndexManifest({
    format: DESIGN_INDEX_FORMAT,
    indexVersion: DESIGN_INDEX_VERSION,
    documentFormat: "codeshell.design",
    documentVersion: 3,
    name: document.name,
    canvas: document.canvas,
    tokens: document.tokens,
    resources: document.resources ?? [],
    activePageId: document.activePageId,
    pages,
  });
  return {
    mode: "indexed",
    bytes: indexedObjectBytes,
    indexedObjectBytes,
    primarySource: serializeDesignIndexManifest(manifest),
    manifest,
    parts,
    partCount: pages.reduce((sum, page) => sum + page.partCount, 0),
    changedPageCount,
  };
}

function normalizePageRecord(value, descriptor) {
  assertExactKeys(
    value,
    new Set(["format", "version", "id", "name", "children"]),
    `页面对象 ${descriptor.id}`,
  );
  if (
    value.format !== DESIGN_PAGE_FORMAT ||
    value.version !== DESIGN_PAGE_VERSION ||
    value.id !== descriptor.id ||
    value.name !== descriptor.name ||
    !Array.isArray(value.children) ||
    summarizePageNodes(value.children).nodeCount !== descriptor.nodeCount
  ) {
    throw new Error(`页面对象 ${descriptor.id} 与索引不一致`);
  }
  return {
    id: value.id,
    name: value.name,
    children: value.children,
  };
}

export function parseDesignIndexSource(primarySource) {
  if (typeof primarySource !== "string") throw new Error("设计索引必须是 UTF-8 文本");
  let parsed;
  try {
    parsed = JSON.parse(primarySource);
  } catch {
    return null;
  }
  if (parsed?.format !== DESIGN_INDEX_FORMAT) return null;
  return normalizeDesignIndexManifest(parsed);
}

export async function resolveDesignIndexPages({ manifest, pageIds, readText, sha256 }) {
  if (typeof readText !== "function" || typeof sha256 !== "function") {
    throw new Error("读取索引设计缺少页面读取或摘要能力");
  }
  const normalizedManifest = normalizeDesignIndexManifest(
    manifest?.dependencyCatalogComplete === true ||
      manifest?.dependencyCatalogComplete === false
      ? persistentDesignIndexManifest(manifest)
      : manifest,
  );
  const requestedIds = new Set(pageIds ?? normalizedManifest.pages.map((page) => page.id));
  for (const pageId of requestedIds) {
    if (!normalizedManifest.pages.some((page) => page.id === pageId)) {
      throw new Error(`设计索引不存在页面：${pageId}`);
    }
  }
  const pages = new Map();
  for (const descriptor of normalizedManifest.pages) {
    if (!requestedIds.has(descriptor.id)) continue;
    const contents = [];
    for (let index = 0; index < descriptor.partCount; index += 1) {
      const result = await readText(pagePartPath(descriptor.sha256, index));
      const content = typeof result === "string" ? result : result?.content;
      if (
        typeof content !== "string" ||
        byteLength(content) < 1 ||
        byteLength(content) > MAX_DESIGN_BUNDLE_PART_BYTES
      ) {
        throw new Error(`页面 ${descriptor.id} 的分片 ${index + 1} 无效`);
      }
      contents.push(content);
    }
    const source = contents.join("");
    if (byteLength(source) !== descriptor.bytes) {
      throw new Error(`页面 ${descriptor.id} 重组后的字节数无效`);
    }
    if ((await sha256(source)) !== descriptor.sha256) {
      throw new Error(`页面 ${descriptor.id} 的摘要校验失败`);
    }
    let page;
    try {
      page = normalizePageRecord(JSON.parse(source), descriptor);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`页面 ${descriptor.id} 不是有效 JSON`);
      throw error;
    }
    pages.set(page.id, page);
  }
  return pages;
}

export async function resolveDesignIndexDocument({ primarySource, readText, sha256 }) {
  const manifest = parseDesignIndexSource(primarySource);
  if (!manifest) return null;
  const pageRecords = await resolveDesignIndexPages({
    manifest,
    readText,
    sha256,
  });
  const pages = manifest.pages.map((descriptor) => pageRecords.get(descriptor.id));
  const document = {
    format: "codeshell.design",
    version: 3,
    name: manifest.name,
    canvas: manifest.canvas,
    tokens: manifest.tokens,
    resources: manifest.resources,
    activePageId: manifest.activePageId,
    pages,
  };
  return {
    mode: "indexed",
    bytes: byteLength(serializeDesignDocument(document)),
    manifest,
    document,
  };
}
