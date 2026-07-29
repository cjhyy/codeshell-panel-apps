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

export const DESIGN_INDEX_FORMAT = "codeshell.design.index";
export const DESIGN_INDEX_VERSION = 1;
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
  assertExactKeys(
    value,
    new Set(["id", "name", "nodeCount", "bytes", "sha256", "partCount"]),
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
  pageIds.add(value.id);
  return {
    id: value.id,
    name: value.name,
    nodeCount: value.nodeCount,
    bytes: value.bytes,
    sha256: value.sha256,
    partCount: value.partCount,
  };
}

export function normalizeDesignIndexManifest(value) {
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
      "activePageId",
      "pages",
    ]),
    "设计索引",
  );
  if (value.format !== DESIGN_INDEX_FORMAT || value.indexVersion !== DESIGN_INDEX_VERSION) {
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
    indexVersion: DESIGN_INDEX_VERSION,
    documentFormat: "codeshell.design",
    documentVersion: 3,
    name: value.name,
    canvas: {
      width: value.canvas.width,
      height: value.canvas.height,
      background: value.canvas.background.toLowerCase(),
    },
    tokens: { colors },
    activePageId: value.activePageId,
    pages,
  };
  const source = `${JSON.stringify(manifest, null, 2)}\n`;
  if (byteLength(source) > MAX_WORKSPACE_DESIGN_TEXT_BYTES) {
    throw new Error("设计索引目录超过 Host 单文件预算；需要升级目录分页格式");
  }
  return manifest;
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

function countPageNodes(children) {
  let count = 0;
  const pending = [...children];
  while (pending.length > 0) {
    const node = pending.pop();
    count += 1;
    if (count > MAX_DESIGN_NODES_PER_PAGE) {
      throw new Error(`页面最多包含 ${MAX_DESIGN_NODES_PER_PAGE} 个源图层`);
    }
    if (Array.isArray(node?.children)) pending.push(...node.children);
  }
  return count;
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
      ? normalizeDesignIndexManifest(previousManifest)
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
    const descriptor = {
      id: page.id,
      name: page.name,
      nodeCount: countPageNodes(page.children),
      bytes,
      sha256: digest,
      partCount: split.length,
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
    activePageId: repository.activePageId,
    pages,
  });
  return {
    mode: "indexed",
    bytes: byteLength(logicalSource),
    indexedObjectBytes,
    primarySource: `${JSON.stringify(manifest, null, 2)}\n`,
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
    countPageNodes(value.children) !== descriptor.nodeCount
  ) {
    throw new Error(`页面对象 ${descriptor.id} 与索引不一致`);
  }
  return {
    id: value.id,
    name: value.name,
    children: value.children,
  };
}

export async function resolveDesignIndexDocument({ primarySource, readText, sha256 }) {
  if (typeof primarySource !== "string") throw new Error("设计索引必须是 UTF-8 文本");
  let parsed;
  try {
    parsed = JSON.parse(primarySource);
  } catch {
    return null;
  }
  if (parsed?.format !== DESIGN_INDEX_FORMAT) return null;
  if (typeof readText !== "function" || typeof sha256 !== "function") {
    throw new Error("读取索引设计缺少页面读取或摘要能力");
  }
  const manifest = normalizeDesignIndexManifest(parsed);
  const pages = [];
  for (const descriptor of manifest.pages) {
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
    pages.push(page);
  }
  const document = {
    format: "codeshell.design",
    version: 3,
    name: manifest.name,
    canvas: manifest.canvas,
    tokens: manifest.tokens,
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
