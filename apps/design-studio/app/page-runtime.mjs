import { resolveDesignIndexPages } from "./document-index.mjs";
import { normalizeDesignDocument } from "./document.mjs";

export const DEFAULT_INDEXED_PAGE_CACHE_SIZE = 8;

function pageDescriptorMap(manifest) {
  return new Map(manifest.pages.map((page) => [page.id, page]));
}

function summarizeRecord(record) {
  const componentIds = new Set();
  const instanceComponentIds = new Set();
  let nodeCount = 0;
  const pending = [...(record.children ?? [])];
  while (pending.length > 0) {
    const node = pending.pop();
    nodeCount += 1;
    if (node?.type === "component" && typeof node.id === "string") {
      componentIds.add(node.id);
    }
    if (node?.type === "instance" && typeof node.componentId === "string") {
      instanceComponentIds.add(node.componentId);
    }
    if (Array.isArray(node?.children)) pending.push(...node.children);
  }
  return {
    nodeCount,
    componentIds: [...componentIds].sort(),
    instanceComponentIds: [...instanceComponentIds].sort(),
  };
}

export function indexedPageDependencyClosure(manifest, rootPageIds) {
  const descriptors = pageDescriptorMap(manifest);
  const requested = new Set(rootPageIds);
  for (const pageId of requested) {
    if (!descriptors.has(pageId)) throw new Error(`设计索引不存在页面：${pageId}`);
  }
  if (!manifest.dependencyCatalogComplete) {
    return new Set(manifest.pages.map((page) => page.id));
  }
  const providers = new Map();
  for (const descriptor of manifest.pages) {
    for (const componentId of descriptor.componentIds) {
      const existing = providers.get(componentId);
      if (existing && existing !== descriptor.id) {
        throw new Error(`组件 ID 在多个页面重复：${componentId}`);
      }
      providers.set(componentId, descriptor.id);
    }
  }
  const pending = [...requested];
  while (pending.length > 0) {
    const pageId = pending.pop();
    const descriptor = descriptors.get(pageId);
    for (const componentId of descriptor.instanceComponentIds) {
      const providerPageId = providers.get(componentId);
      if (!providerPageId) {
        throw new Error(`页面 ${pageId} 引用了索引中不存在的组件：${componentId}`);
      }
      if (requested.has(providerPageId)) continue;
      requested.add(providerPageId);
      pending.push(providerPageId);
    }
  }
  return requested;
}

export function materializeIndexedDesignState({
  manifest,
  records,
  activePageId = manifest.activePageId,
  metadata = manifest,
}) {
  if (!(records instanceof Map) || !records.has(activePageId)) {
    throw new Error(`活动页面尚未加载：${activePageId}`);
  }
  const loadedRepositoryPages = manifest.pages
    .filter((descriptor) => records.has(descriptor.id))
    .map((descriptor) => records.get(descriptor.id));
  const normalized = normalizeDesignDocument({
    format: "codeshell.design",
    version: 3,
    name: metadata.name,
    canvas: metadata.canvas,
    tokens: metadata.tokens,
    resources: metadata.resources ?? manifest.resources ?? [],
    activePageId,
    pages: loadedRepositoryPages,
  });
  const loadedPages = new Map(normalized.pages.map((page) => [page.id, page]));
  const names = new Map(
    (metadata.pages ?? []).map((page) => [page.id, page.name]),
  );
  const pages = manifest.pages.map((descriptor) => {
    const loaded = loadedPages.get(descriptor.id);
    if (loaded) {
      return {
        ...loaded,
        name: names.get(descriptor.id) ?? loaded.name,
        nodeCount: loaded.nodes.length,
        loaded: true,
      };
    }
    return {
      id: descriptor.id,
      name: names.get(descriptor.id) ?? descriptor.name,
      nodes: null,
      nodeCount: descriptor.nodeCount,
      loaded: false,
    };
  });
  const activePage = pages.find((page) => page.id === activePageId);
  return {
    ...normalized,
    activePageId,
    pages,
    nodes: activePage.nodes,
  };
}

export class IndexedPageCache {
  constructor({
    manifest,
    readText,
    sha256,
    maximumLoadedPages = DEFAULT_INDEXED_PAGE_CACHE_SIZE,
  }) {
    if (!Number.isInteger(maximumLoadedPages) || maximumLoadedPages < 1) {
      throw new Error("页面缓存容量必须是正整数");
    }
    this.manifest = manifest;
    this.readText = readText;
    this.sha256 = sha256;
    this.maximumLoadedPages = maximumLoadedPages;
    this.entries = new Map();
    this.protectedPageIds = new Set();
    this.clock = 0;
  }

  descriptor(pageId) {
    return this.manifest.pages.find((page) => page.id === pageId) ?? null;
  }

  has(pageId) {
    return this.entries.has(pageId);
  }

  get(pageId) {
    const entry = this.entries.get(pageId);
    if (!entry) return null;
    entry.lastAccess = ++this.clock;
    return entry.record;
  }

  loadedPageIds() {
    return [...this.entries.keys()];
  }

  dirtyPageIds() {
    return [...this.entries]
      .filter(([, entry]) => entry.dirty)
      .map(([pageId]) => pageId);
  }

  set(pageId, record, { dirty = false } = {}) {
    const descriptor = this.descriptor(pageId);
    if (!descriptor) throw new Error(`设计索引不存在页面：${pageId}`);
    const previous = this.entries.get(pageId);
    this.entries.set(pageId, {
      record,
      dirty: dirty || previous?.dirty === true,
      lastAccess: ++this.clock,
    });
    if (dirty || previous?.dirty === true) {
      Object.assign(descriptor, summarizeRecord(record), { name: record.name });
    }
    return record;
  }

  markDirty(pageId) {
    const entry = this.entries.get(pageId);
    if (!entry) throw new Error(`页面尚未加载：${pageId}`);
    entry.dirty = true;
    entry.lastAccess = ++this.clock;
    Object.assign(this.descriptor(pageId), summarizeRecord(entry.record), {
      name: entry.record.name,
    });
  }

  markClean(pageId) {
    const entry = this.entries.get(pageId);
    if (entry) entry.dirty = false;
  }

  markAllClean() {
    for (const entry of this.entries.values()) entry.dirty = false;
  }

  register(record, index = this.manifest.pages.length) {
    if (
      !record ||
      typeof record.id !== "string" ||
      typeof record.name !== "string" ||
      !Array.isArray(record.children) ||
      this.descriptor(record.id)
    ) {
      throw new Error("本地页面记录无效或重复");
    }
    const summary = summarizeRecord(record);
    this.manifest.pages.splice(Math.min(index, this.manifest.pages.length), 0, {
      id: record.id,
      name: record.name,
      nodeCount: summary.nodeCount,
      bytes: 1,
      sha256: "0".repeat(64),
      partCount: 1,
      componentIds: summary.componentIds,
      instanceComponentIds: summary.instanceComponentIds,
    });
    this.set(record.id, record, { dirty: true });
  }

  remove(pageId) {
    const index = this.manifest.pages.findIndex((page) => page.id === pageId);
    if (index >= 0) this.manifest.pages.splice(index, 1);
    this.entries.delete(pageId);
    this.protectedPageIds.delete(pageId);
  }

  updateManifest(manifest) {
    this.manifest = manifest;
    this.markAllClean();
  }

  async ensure(rootPageIds) {
    const requiredPageIds = indexedPageDependencyClosure(this.manifest, rootPageIds);
    const missingPageIds = [...requiredPageIds].filter((pageId) => !this.entries.has(pageId));
    if (missingPageIds.length > 0) {
      const records = await resolveDesignIndexPages({
        manifest: this.manifest,
        pageIds: missingPageIds,
        readText: this.readText,
        sha256: this.sha256,
      });
      for (const [pageId, record] of records) this.set(pageId, record);
    }
    this.protectedPageIds = requiredPageIds;
    this.evict();
    return new Map(
      [...requiredPageIds].map((pageId) => [pageId, this.get(pageId)]),
    );
  }

  evict(additionalProtectedPageIds = []) {
    const dirtyPageIds = [...this.entries]
      .filter(([, entry]) => entry.dirty)
      .map(([pageId]) => pageId);
    const dirtyDependencyPageIds =
      dirtyPageIds.length > 0
        ? indexedPageDependencyClosure(this.manifest, dirtyPageIds)
        : [];
    const protectedPageIds = new Set([
      ...this.protectedPageIds,
      ...dirtyDependencyPageIds,
      ...additionalProtectedPageIds,
    ]);
    while (this.entries.size > this.maximumLoadedPages) {
      const candidate = [...this.entries]
        .filter(
          ([pageId, entry]) =>
            !protectedPageIds.has(pageId) && entry.dirty !== true,
        )
        .sort((left, right) => left[1].lastAccess - right[1].lastAccess)[0];
      if (!candidate) break;
      this.entries.delete(candidate[0]);
    }
  }
}
