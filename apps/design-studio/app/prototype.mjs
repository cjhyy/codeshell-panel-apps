import {
  normalizeDesignDocument,
  normalizeDesignState,
  serializeDesignDocument,
} from "./document.mjs";
import { projectContextKey } from "./project-context.mjs";
import { renderDesignFrontendPage } from "./frontend-export.mjs";
import {
  designSidecarPath,
  isMissingDesignSidecar,
  readDesignSidecar,
  writeDesignSidecar,
} from "./design-sidecar.mjs";

export const PROTOTYPE_FORMAT = "codeshell.design.prototype";
export const MAX_PROTOTYPE_LINKS = 5_000;
export const MAX_PROTOTYPE_BYTES = 2 * 1024 * 1024;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 160 &&
  !/[\u0000-\u001f\u007f]/u.test(value);
const fail = (message) => {
  throw Error(`原型配置无效：${message}`);
};
const keys = (value, allowed) => {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key)))
    fail("包含未知字段或无效对象");
};
const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const json = (value) =>
  JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");

export const prototypePath = (path) => designSidecarPath(path, ".prototype.json");
export function prototypeScopeKey(snapshot) {
  return JSON.stringify([
    projectContextKey(snapshot.context ?? snapshot),
    snapshot.path,
    snapshot.workspaceEpoch ?? null,
    snapshot.documentEpoch ?? null,
  ]);
}
export function isSafePrototypeUrl(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 2048 ||
    /[\u0000-\u0020\u007f]/u.test(value)
  )
    return false;
  try {
    return ["https:", "http:", "mailto:", "tel:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
function repositoryDocument(input) {
  const state = Array.isArray(input?.nodes)
    ? normalizeDesignState(input)
    : normalizeDesignDocument(input);
  return JSON.parse(serializeDesignDocument(state));
}
function nodeIds(page) {
  const ids = new Set();
  const visit = (nodes) => {
    for (const node of nodes) {
      ids.add(node.id);
      if (Array.isArray(node.children)) visit(node.children);
    }
  };
  visit(page.children ?? page.nodes ?? []);
  return ids;
}
export function createPrototype(document) {
  return {
    format: PROTOTYPE_FORMAT,
    version: 1,
    startPageId: document.activePageId ?? document.pages?.[0]?.id,
    links: [],
  };
}

/** Validate schema independently; when document is supplied, also validate every referenced target. */
export function normalizePrototype(input, document) {
  keys(input, ["format", "version", "startPageId", "links", "breakpoints"]);
  if (
    input.format !== PROTOTYPE_FORMAT ||
    input.version !== 1 ||
    !identifier(input.startPageId) ||
    !Array.isArray(input.links) ||
    input.links.length > MAX_PROTOTYPE_LINKS
  )
    fail("格式、起始页或交互数量不正确");
  const ids = new Set(),
    targets = new Set();
  const links = input.links.map((link) => {
    keys(link, ["id", "pageId", "nodeId", "event", "action", "targetPageId", "url"]);
    if (
      !identifier(link.id) ||
      ids.has(link.id) ||
      !identifier(link.pageId) ||
      !identifier(link.nodeId) ||
      link.event !== "click" ||
      !["navigate", "back", "open-url"].includes(link.action)
    )
      fail("交互 ID、图层或动作不正确");
    const target = JSON.stringify([link.pageId, link.nodeId]);
    if (targets.has(target)) fail("同一图层只能有一个点击动作");
    ids.add(link.id);
    targets.add(target);
    if (
      link.action === "navigate"
        ? !identifier(link.targetPageId) || link.url !== undefined
        : link.action === "open-url"
          ? !isSafePrototypeUrl(link.url) || link.targetPageId !== undefined
          : link.targetPageId !== undefined || link.url !== undefined
    )
      fail("跳转目标或 URL 不正确（仅允许 http、https、mailto、tel）");
    return {
      id: link.id,
      pageId: link.pageId,
      nodeId: link.nodeId,
      event: "click",
      action: link.action,
      ...(link.action === "navigate"
        ? { targetPageId: link.targetPageId }
        : link.action === "open-url"
          ? { url: link.url }
          : {}),
    };
  });
  if (
    input.breakpoints !== undefined &&
    (!Array.isArray(input.breakpoints) || input.breakpoints.length > 64)
  )
    fail("响应断点数量不正确");
  const breakIds = new Set();
  const breakpoints = (input.breakpoints ?? [])
    .map((point) => {
      keys(point, ["id", "minWidth", "maxWidth", "pageId"]);
      if (
        !identifier(point.id) ||
        breakIds.has(point.id) ||
        !identifier(point.pageId) ||
        !Number.isInteger(point.minWidth) ||
        point.minWidth < 0 ||
        point.minWidth > 20000 ||
        (point.maxWidth !== undefined &&
          (!Number.isInteger(point.maxWidth) ||
            point.maxWidth < point.minWidth ||
            point.maxWidth > 20000))
      )
        fail("响应断点范围不正确");
      breakIds.add(point.id);
      return {
        id: point.id,
        minWidth: point.minWidth,
        ...(point.maxWidth === undefined ? {} : { maxWidth: point.maxWidth }),
        pageId: point.pageId,
      };
    })
    .sort((a, b) => a.minWidth - b.minWidth);
  for (let index = 1; index < breakpoints.length; index++) {
    if ((breakpoints[index - 1].maxWidth ?? Infinity) >= breakpoints[index].minWidth)
      fail("响应断点范围不能重叠");
  }
  const result = {
    format: PROTOTYPE_FORMAT,
    version: 1,
    startPageId: input.startPageId,
    links,
    ...(input.breakpoints !== undefined ? { breakpoints } : {}),
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_PROTOTYPE_BYTES)
    fail("配置超过 2 MiB");
  if (document) {
    const diagnostics = prototypeDiagnostics(result, document);
    if (diagnostics.length) fail(diagnostics[0].message);
  }
  return result;
}
export function prototypeDiagnostics(value, document) {
  const model = normalizePrototype(value),
    pages = new Map(document.pages.map((page) => [page.id, nodeIds(page)])),
    issues = [];
  if (!pages.has(model.startPageId))
    issues.push({ code: "missing-start-page", message: "起始页面已移除" });
  for (const link of model.links) {
    if (!pages.get(link.pageId)?.has(link.nodeId))
      issues.push({
        code: "missing-source",
        linkId: link.id,
        message: `交互 ${link.id} 的来源图层已移除`,
      });
    else if (link.action === "navigate" && !pages.has(link.targetPageId))
      issues.push({
        code: "missing-target",
        linkId: link.id,
        message: `交互 ${link.id} 的目标页面已移除`,
      });
  }
  for (const point of model.breakpoints ?? [])
    if (!pages.has(point.pageId))
      issues.push({
        code: "missing-breakpoint-page",
        breakpointId: point.id,
        message: `断点 ${point.id} 的页面已移除`,
      });
  return issues;
}

/** Only apply after the user explicitly requests repair; original models are never mutated. */
export function repairPrototype(value, document) {
  const model = normalizePrototype(value),
    diagnostics = prototypeDiagnostics(model, document);
  const invalidLinks = new Set(diagnostics.map((issue) => issue.linkId)),
    invalidPoints = new Set(diagnostics.map((issue) => issue.breakpointId));
  return normalizePrototype(
    {
      ...model,
      startPageId: document.pages.some((page) => page.id === model.startPageId)
        ? model.startPageId
        : (document.activePageId ?? document.pages[0].id),
      links: model.links.filter((link) => !invalidLinks.has(link.id)),
      ...(model.breakpoints
        ? { breakpoints: model.breakpoints.filter((point) => !invalidPoints.has(point.id)) }
        : {}),
    },
    document,
  );
}

export const validatePrototype = normalizePrototype;

/** Sidecars use the Host's read revision for an atomic, compare-and-swap commit. */
export function createPrototypeStore({
  getSnapshot,
  capture,
  call,
  sha256,
  checkScope = () => {},
}) {
  function operation() {
    const snapshot = getSnapshot(),
      scopeKey = prototypeScopeKey(snapshot),
      revision = snapshot.stateRevision;
    const check = () => {
      const current = getSnapshot();
      if (prototypeScopeKey(current) !== scopeKey)
        throw Error("项目或设计已切换，旧原型操作已停止");
      if (current.ready === false || (current.context ?? current).trusted !== true)
        throw Error("当前项目尚未准备好");
      if (revision !== undefined && current.stateRevision !== revision)
        throw Error("设计在原型操作期间发生变化，请重新操作");
      checkScope(snapshot);
    };
    check();
    return { snapshot, scopeKey, path: prototypePath(snapshot.path), check };
  }
  async function content(operation) {
    let response;
    try {
      response = await readDesignSidecar({
        path: operation.path,
        call,
        check: operation.check,
        sha256,
      });
    } catch (error) {
      operation.check();
      if (!isMissingDesignSidecar(error)) throw error;
      return {
        prototype: null,
        baseline: { scopeKey: operation.scopeKey, expectedModifiedAt: null },
      };
    }
    operation.check();
    if (response.path !== undefined && response.path !== operation.path)
      throw Error("Host 返回了其他路径的原型配置");
    if (new TextEncoder().encode(response.content).length > MAX_PROTOTYPE_BYTES)
      fail("配置超过 2 MiB");
    let value;
    try {
      value = JSON.parse(response.content);
    } catch {
      fail("JSON 无法解析；原文件已保留");
    }
    const prototype = normalizePrototype(value);
    const baseline = {
      scopeKey: operation.scopeKey,
      ...(typeof response.revision === "string" && response.revision
        ? { expectedRevision: response.revision }
        : {}),
      ...(Number.isFinite(response.modifiedAt) ? { expectedModifiedAt: response.modifiedAt } : {}),
    };
    if (baseline.expectedRevision === undefined && baseline.expectedModifiedAt === undefined)
      throw Error("Host 未提供原型文件版本，无法安全保存");
    return { prototype, baseline };
  }
  async function captured(operation) {
    const value = await capture({ scope: operation.snapshot }, operation.check);
    operation.check();
    return value?.document
      ? { ...value, document: repositoryDocument(value.document) }
      : { document: repositoryDocument(value) };
  }
  return {
    async read() {
      const current = operation(),
        result = await content(current),
        state = await captured(current);
      current.check();
      return {
        ...state,
        ...result,
        prototype: result.prototype ?? createPrototype(state.document),
        path: current.path,
      };
    },
    async save(value, { baseline } = {}) {
      const current = operation(),
        state = await captured(current);
      const prototype = normalizePrototype(value, state.document);
      const basis = baseline ?? (await content(current)).baseline;
      if (basis.scopeKey !== current.scopeKey)
        throw Error("原型配置属于其他项目或设计，请重新读取");
      if (basis.expectedRevision === undefined && basis.expectedModifiedAt === undefined)
        throw Error("原型版本缺失，请重新读取后保存");
      current.check();
      const result = await writeDesignSidecar({
        path: current.path,
        content: `${JSON.stringify(prototype, null, 2)}\n`,
        expectedRevision: basis.expectedRevision,
        expectedModifiedAt: basis.expectedModifiedAt,
        call,
        sha256,
        check: current.check,
      });
      current.check();
      if (
        !(typeof result?.revision === "string" && result.revision) &&
        !Number.isFinite(result?.modifiedAt)
      ) {
        const saved = await content(current);
        if (JSON.stringify(saved.prototype) !== JSON.stringify(prototype))
          throw Error("原型保存后又发生变化，请重新读取");
        return { ...state, prototype, path: current.path, baseline: saved.baseline };
      }
      return {
        ...state,
        prototype,
        path: current.path,
        baseline: {
          scopeKey: current.scopeKey,
          ...(typeof result?.revision === "string" && result.revision
            ? { expectedRevision: result.revision }
            : {}),
          ...(Number.isFinite(result?.modifiedAt) ? { expectedModifiedAt: result.modifiedAt } : {}),
        },
      };
    },
  };
}

function reviewThreads(comments, document) {
  const pages = new Map(document.pages.map((page) => [page.id, nodeIds(page)]));
  const threads = Array.isArray(comments) ? comments : (comments?.threads ?? []);
  if (!Array.isArray(threads)) return [];
  return threads
    .slice(0, 1000)
    .filter(
      (thread) =>
        object(thread) &&
        pages.has(thread.pageId) &&
        (thread.nodeId == null || pages.get(thread.pageId).has(thread.nodeId)) &&
        typeof thread.text === "string",
    )
    .map((thread, index) => ({
      id: identifier(thread.id) ? thread.id : `review-${index + 1}`,
      pageId: thread.pageId,
      nodeId: thread.nodeId ?? null,
      text: thread.text.slice(0, 10000),
      author: String(thread.author ?? "评审").slice(0, 120),
      status: thread.status === "resolved" ? "resolved" : "open",
      replies: Array.isArray(thread.replies)
        ? thread.replies
            .slice(0, 200)
            .filter((reply) => typeof reply?.text === "string")
            .map((reply) => ({
              text: reply.text.slice(0, 10000),
              author: String(reply.author ?? "评审").slice(0, 120),
            }))
        : [],
    }));
}
function safeResources(input) {
  const result = new Map();
  for (const [id, source] of input instanceof Map ? input : Object.entries(input ?? {})) {
    if (
      typeof source !== "string" ||
      !/^data:(?:image\/(?:png|jpeg|webp|gif|svg\+xml)|font\/[\w.+-]+|application\/(?:font-[\w.+-]+|x-font-[\w.+-]+|octet-stream));base64,[a-z0-9+/=\r\n]+$/iu.test(
        source,
      )
    )
      throw Error(`原型离线资源 ${id} 不是受支持的内嵌图片或字体`);
    result.set(id, source);
  }
  return result;
}
function cssString(value) {
  return `"${String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replace(/[\r\n\f<>]/gu, (c) => `\\${c.codePointAt(0).toString(16)} `)}"`;
}

// This code is generated by the exporter, never supplied by the design model.
function prototypeRuntime(model, comments) {
  const pages = [...document.querySelectorAll(".cs-page")],
    byPage = new Map(pages.map((page) => [page.dataset.codeshellPageId, page]));
  const links = new Map(model.links.map((link) => [link.id, link]));
  const title = document.querySelector("#prototype-current-page"),
    back = document.querySelector("#prototype-back");
  const picker = document.querySelector("#prototype-page-picker"),
    review = document.querySelector("#prototype-review-toggle");
  const details = document.querySelector("#prototype-review-details"),
    reviewText = document.querySelector("#prototype-review-text");
  let current,
    stack = [],
    explicitNavigation = false;
  const fromHash = () => {
    try {
      return decodeURIComponent(location.hash.slice(1));
    } catch {
      return null;
    }
  };
  const responsivePage = () =>
    model.breakpoints?.find(
      (point) =>
        innerWidth >= point.minWidth &&
        (point.maxWidth === undefined || innerWidth <= point.maxWidth),
    )?.pageId ?? model.startPageId;
  function show(id, { push = true, focus = true, hash = true } = {}) {
    if (!byPage.has(id)) return;
    if (id !== current && push && current) stack.push(current);
    current = id;
    for (const page of pages) {
      page.hidden = page.dataset.codeshellPageId !== current;
      page.inert = page.hidden;
    }
    const page = byPage.get(current);
    title.textContent = page.dataset.codeshellName;
    picker.value = current;
    back.disabled = !stack.length;
    details.hidden = true;
    if (hash) {
      try {
        history.replaceState(null, "", `#${encodeURIComponent(current)}`);
      } catch (error) {
        if (error.name !== "SecurityError") throw error;
      }
    }
    if (focus) {
      page.focus({ preventScroll: true });
      scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
  }
  function goBack() {
    if (stack.length) {
      explicitNavigation = true;
      show(stack.pop(), { push: false });
    }
  }
  back.addEventListener("click", goBack);
  picker.addEventListener("change", () => {
    explicitNavigation = true;
    show(picker.value);
  });
  document.addEventListener("click", (event) => {
    const anchor = event.target.closest("a[data-prototype-link]");
    if (
      !anchor ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link = links.get(anchor.dataset.prototypeLink);
    if (!link || link.action === "open-url") return;
    event.preventDefault();
    explicitNavigation = true;
    if (link.action === "back") goBack();
    else show(link.targetPageId);
  });
  addEventListener("hashchange", () => {
    const id = fromHash();
    if (byPage.has(id)) {
      explicitNavigation = true;
      show(id, { hash: false });
    }
  });
  addEventListener("resize", () => {
    if (!explicitNavigation) show(responsivePage(), { push: false, focus: false });
  });
  review.addEventListener("change", () => {
    document.body.classList.toggle("prototype-review-mode", review.checked);
    if (!review.checked) details.hidden = true;
  });
  const pinCounts = new Map();
  for (const [index, thread] of comments.entries()) {
    const page = byPage.get(thread.pageId);
    const node = thread.nodeId
      ? [...page.querySelectorAll("[data-codeshell-id]")].find(
          (node) => node.dataset.codeshellId === thread.nodeId,
        )
      : page;
    if (!node) continue;
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "cs-prototype-review-pin";
    pin.textContent = String(index + 1);
    pin.setAttribute("aria-label", `讨论 ${index + 1}：${thread.text.slice(0, 100)}`);
    pin.dataset.reviewId = thread.id;
    pin.style.left = `${(pinCounts.get(node) ?? 0) * 30}px`;
    pinCounts.set(node, (pinCounts.get(node) ?? 0) + 1);
    pin.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      reviewText.replaceChildren();
      for (const message of [thread, ...thread.replies]) {
        const body = document.createElement("p"),
          author = document.createElement("strong");
        author.textContent = `${message.author}：`;
        body.append(author, document.createTextNode(message.text));
        reviewText.append(body);
      }
      details.hidden = false;
      document.querySelector("#prototype-review-close").focus();
    });
    node.append(pin);
  }
  document.querySelector("#prototype-review-close").addEventListener("click", () => {
    details.hidden = true;
  });
  const initialHash = fromHash();
  explicitNavigation = byPage.has(initialHash);
  show(explicitNavigation ? initialHash : responsivePage(), { push: false, focus: false });
}

export function exportDesignPrototype(
  input,
  { prototype, resourceDataUrls = new Map(), comments, title } = {},
) {
  const document = repositoryDocument(input),
    model = normalizePrototype(prototype ?? createPrototype(document), document);
  const resources = safeResources(resourceDataUrls),
    threads = reviewThreads(comments, document);
  const pages = document.pages
    .map((page) => {
      const names = new Map();
      const visit = (nodes) => {
        for (const node of nodes) {
          names.set(node.id, node.name);
          if (node.children) visit(node.children);
        }
      };
      visit(page.children);
      const links = new Map(
        model.links
          .filter((link) => link.pageId === page.id)
          .map((link) => [
            link.nodeId,
            {
              ...link,
              href:
                link.action === "open-url"
                  ? link.url
                  : link.action === "back"
                    ? "#prototype-back"
                    : `#${encodeURIComponent(link.targetPageId)}`,
              label: `${names.get(link.nodeId) || link.nodeId}：${link.action === "back" ? "返回" : link.action === "open-url" ? "打开链接" : `前往 ${document.pages.find((page) => page.id === link.targetPageId).name}`}`,
              external: link.action === "open-url",
            },
          ]),
      );
      return renderDesignFrontendPage(document, {
        pageId: page.id,
        resourceDataUrls: resources,
        prototypeMode: true,
        prototypeLinks: links,
      }).replace(
        '<main class="cs-page"',
        `<main class="cs-page" tabindex="-1"${page.id === model.startPageId ? "" : " hidden inert"}`,
      );
    })
    .join("\n");
  const fonts = (document.resources ?? [])
    .filter((resource) => resource.kind === "font" && resources.has(resource.id))
    .map(
      (resource) =>
        `@font-face{font-family:${cssString(resource.family)};src:url(${cssString(resources.get(resource.id))});font-style:${resource.style === "italic" ? "italic" : "normal"};font-weight:${Number(resource.weight) || 400};font-display:swap;}`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title ?? `${document.name} · 可交互原型`)}</title>
<style>${fonts}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:ui-sans-serif,system-ui,sans-serif}body{background:${document.canvas.background};padding-top:52px}[hidden]{display:none!important}
.prototype-toolbar{position:fixed;inset:0 0 auto;z-index:10000;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:8px 12px;min-height:52px;background:#fff;color:#222;border-bottom:1px solid #ddd;font-size:13px}.prototype-toolbar button,.prototype-toolbar select{font:inherit;padding:6px 10px}.prototype-toolbar strong{flex:1;min-width:80px}.prototype-toolbar label{display:flex;align-items:center;gap:4px}
.cs-page{position:relative;width:min(100%,${document.canvas.width}px);min-width:0;height:${document.canvas.height}px;margin:0 auto;overflow:hidden;background:${document.canvas.background}}.cs-node{min-width:0}.cs-text{margin:0}.cs-image,.cs-prototype-image{display:block}.cs-instance-content{pointer-events:none}.cs-page:focus{outline:none}
.cs-prototype-hotspot{position:absolute;inset:0;z-index:1;cursor:pointer;text-decoration:none;color:inherit}.cs-prototype-hotspot:focus-visible{outline:3px solid #2563eb;outline-offset:-3px;background:#2563eb10}.cs-prototype-review-pin{display:none;position:absolute;top:0;left:0;z-index:3;border:2px solid #fff;border-radius:50%;min-width:26px;height:26px;background:#1d4ed8;color:#fff;font-weight:700;cursor:pointer}.prototype-review-mode .cs-prototype-review-pin{display:block}#prototype-review-details{position:fixed;right:12px;top:64px;width:min(360px,calc(100vw - 24px));max-height:70vh;overflow:auto;background:#fff;border:1px solid #ddd;border-radius:10px;box-shadow:0 8px 40px #0002;z-index:10001;padding:16px}#prototype-review-text{white-space:pre-wrap;overflow-wrap:anywhere}#prototype-review-close{float:right}@media(max-width:560px){.prototype-toolbar{gap:6px}.prototype-toolbar strong{display:none}.prototype-toolbar select{max-width:45vw}}
</style></head><body>
<nav class="prototype-toolbar" aria-label="原型导航"><button id="prototype-back" type="button" disabled>返回</button><strong id="prototype-current-page" aria-live="polite"></strong><label>页面<select id="prototype-page-picker">${document.pages.map((page) => `<option value="${escapeHtml(page.id)}">${escapeHtml(page.name)}</option>`).join("")}</select></label><label${threads.length ? "" : " hidden"}><input id="prototype-review-toggle" type="checkbox">评审 ${threads.length}</label></nav>
${pages}
<aside id="prototype-review-details" hidden aria-label="设计评审"><button id="prototype-review-close" type="button">关闭</button><h2>设计讨论</h2><div id="prototype-review-text"></div></aside>
<script>(${prototypeRuntime.toString()})(${json(model)},${json(threads)});</script>
</body></html>\n`;
}
