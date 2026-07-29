export const DESIGN_OPERATION_LOG_VERSION = 1;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pageNodes(document, page) {
  if (!Array.isArray(page.nodes)) return null;
  return page.id === document.activePageId && Array.isArray(document.nodes)
    ? document.nodes
    : page.nodes;
}

export function captureDesignOperationState(document) {
  return {
    name: document.name,
    canvas: clone(document.canvas),
    tokens: clone(document.tokens),
    resources: clone(document.resources ?? []),
    activePageId: document.activePageId,
    pages: document.pages.map((page) => ({
      id: page.id,
      name: page.name,
      nodeCount: Array.isArray(page.nodes)
        ? pageNodes(document, page).length
        : page.nodeCount,
      nodes: clone(pageNodes(document, page)),
    })),
  };
}

function nodeOperations(pageId, beforeNodes, afterNodes) {
  if (!Array.isArray(beforeNodes) || !Array.isArray(afterNodes)) return [];
  const operations = [];
  const beforeById = new Map(beforeNodes.map((node, index) => [node.id, { node, index }]));
  const afterById = new Map(afterNodes.map((node, index) => [node.id, { node, index }]));
  for (const [nodeId, before] of beforeById) {
    const after = afterById.get(nodeId);
    if (!after) {
      operations.push({
        type: "remove-node",
        pageId,
        index: before.index,
        node: clone(before.node),
      });
    } else if (!equal(before.node, after.node)) {
      operations.push({
        type: "replace-node",
        pageId,
        nodeId,
        before: clone(before.node),
        after: clone(after.node),
      });
    }
  }
  for (const [nodeId, after] of afterById) {
    if (beforeById.has(nodeId)) continue;
    operations.push({
      type: "add-node",
      pageId,
      index: after.index,
      node: clone(after.node),
    });
  }
  const beforeOrder = beforeNodes.map((node) => node.id);
  const afterOrder = afterNodes.map((node) => node.id);
  const survivingBeforeOrder = beforeOrder.filter((id) => afterById.has(id));
  const survivingAfterOrder = afterOrder.filter((id) => beforeById.has(id));
  if (!equal(survivingBeforeOrder, survivingAfterOrder)) {
    operations.push({
      type: "reorder-nodes",
      pageId,
      before: beforeOrder,
      after: afterOrder,
    });
  }
  return operations;
}

export function createDesignOperationRecord(before, after) {
  const operations = [];
  for (const field of ["name", "canvas", "tokens", "resources", "activePageId"]) {
    if (!equal(before[field], after[field])) {
      operations.push({
        type: "set-document",
        field,
        before: clone(before[field]),
        after: clone(after[field]),
      });
    }
  }
  const beforePages = new Map(before.pages.map((page, index) => [page.id, { page, index }]));
  const afterPages = new Map(after.pages.map((page, index) => [page.id, { page, index }]));
  for (const [pageId, beforeEntry] of beforePages) {
    const afterEntry = afterPages.get(pageId);
    if (!afterEntry) {
      operations.push({
        type: "remove-page",
        index: beforeEntry.index,
        page: clone(beforeEntry.page),
      });
      continue;
    }
    if (beforeEntry.page.name !== afterEntry.page.name) {
      operations.push({
        type: "rename-page",
        pageId,
        before: beforeEntry.page.name,
        after: afterEntry.page.name,
      });
    }
    operations.push(
      ...nodeOperations(
        pageId,
        beforeEntry.page.nodes,
        afterEntry.page.nodes,
      ),
    );
  }
  for (const [pageId, afterEntry] of afterPages) {
    if (beforePages.has(pageId)) continue;
    operations.push({
      type: "add-page",
      index: afterEntry.index,
      page: clone(afterEntry.page),
    });
  }
  const beforePageOrder = before.pages.map((page) => page.id);
  const afterPageOrder = after.pages.map((page) => page.id);
  if (
    equal(
      beforePageOrder.filter((id) => afterPages.has(id)),
      afterPageOrder.filter((id) => beforePages.has(id)),
    ) === false
  ) {
    operations.push({
      type: "reorder-pages",
      before: beforePageOrder,
      after: afterPageOrder,
    });
  }
  return {
    version: DESIGN_OPERATION_LOG_VERSION,
    operations,
  };
}

export function isEmptyDesignOperationRecord(record) {
  return !record || !Array.isArray(record.operations) || record.operations.length === 0;
}

function orderedByIds(values, ids) {
  const byId = new Map(values.map((value) => [value.id, value]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  for (const value of values) {
    if (!ids.includes(value.id)) ordered.push(value);
  }
  return ordered;
}

function targetValue(operation, direction) {
  return clone(direction === "forward" ? operation.after : operation.before);
}

function applyOperation(document, operation, direction) {
  if (operation.type === "set-document") {
    document[operation.field] = targetValue(operation, direction);
    return;
  }
  if (operation.type === "rename-page") {
    const page = document.pages.find((candidate) => candidate.id === operation.pageId);
    if (!page) throw new Error(`操作日志找不到页面：${operation.pageId}`);
    page.name = targetValue(operation, direction);
    return;
  }
  if (operation.type === "add-page" || operation.type === "remove-page") {
    const adding =
      (operation.type === "add-page" && direction === "forward") ||
      (operation.type === "remove-page" && direction === "reverse");
    if (adding) {
      if (document.pages.some((page) => page.id === operation.page.id)) return;
      const page = clone(operation.page);
      if (!Array.isArray(page.nodes)) page.nodes = [];
      page.loaded = true;
      page.nodeCount = page.nodes.length;
      document.pages.splice(
        Math.min(operation.index, document.pages.length),
        0,
        page,
      );
    } else {
      const index = document.pages.findIndex((page) => page.id === operation.page.id);
      if (index >= 0) document.pages.splice(index, 1);
    }
    return;
  }
  if (operation.type === "reorder-pages") {
    document.pages = orderedByIds(
      document.pages,
      direction === "forward" ? operation.after : operation.before,
    );
    return;
  }
  const page = document.pages.find((candidate) => candidate.id === operation.pageId);
  if (!page || !Array.isArray(page.nodes)) {
    throw new Error(`操作日志需要已加载页面：${operation.pageId}`);
  }
  const nodes = page.nodes;
  if (operation.type === "replace-node") {
    const index = nodes.findIndex((node) => node.id === operation.nodeId);
    if (index < 0) throw new Error(`操作日志找不到图层：${operation.nodeId}`);
    nodes[index] = targetValue(operation, direction);
  } else if (operation.type === "add-node" || operation.type === "remove-node") {
    const adding =
      (operation.type === "add-node" && direction === "forward") ||
      (operation.type === "remove-node" && direction === "reverse");
    const index = nodes.findIndex((node) => node.id === operation.node.id);
    if (adding) {
      if (index < 0) {
        nodes.splice(Math.min(operation.index, nodes.length), 0, clone(operation.node));
      }
    } else if (index >= 0) {
      nodes.splice(index, 1);
    }
  } else if (operation.type === "reorder-nodes") {
    const reordered = orderedByIds(
      nodes,
      direction === "forward" ? operation.after : operation.before,
    );
    nodes.splice(0, nodes.length, ...reordered);
  }
  page.nodes = nodes;
  page.nodeCount = nodes.length;
}

export function applyDesignOperationRecord(document, record, direction = "forward") {
  if (
    record?.version !== DESIGN_OPERATION_LOG_VERSION ||
    !Array.isArray(record.operations) ||
    !["forward", "reverse"].includes(direction)
  ) {
    throw new Error("设计操作日志无效");
  }
  const operations =
    direction === "forward" ? record.operations : [...record.operations].reverse();
  for (const operation of operations) applyOperation(document, operation, direction);
  const activePage = document.pages.find((page) => page.id === document.activePageId);
  if (!activePage) {
    const fallback = document.pages[0];
    if (!fallback) throw new Error("设计操作日志删除了最后一个页面");
    document.activePageId = fallback.id;
    document.nodes = fallback.nodes;
  } else {
    if (!Array.isArray(activePage.nodes)) {
      throw new Error(`操作日志的活动页面尚未加载：${activePage.id}`);
    }
    document.nodes = activePage.nodes;
  }
  return document;
}

export function serializeDesignOperationJournal(records, cursor = records.length) {
  return `${JSON.stringify(
    {
      format: "codeshell.design.operations",
      version: DESIGN_OPERATION_LOG_VERSION,
      cursor,
      records,
    },
    null,
    2,
  )}\n`;
}
