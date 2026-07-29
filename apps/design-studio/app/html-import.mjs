import { captureHtmlToDesign } from "./html-capture.mjs";

const MAX_HTML_SOURCE_BYTES = 512 * 1024;
const MAX_LINKED_STYLESHEETS = 20;
const BLOCKED_ELEMENTS =
  "script, noscript, iframe, frame, frameset, object, embed, portal, applet, base";
const RESOURCE_ATTRIBUTES = new Set([
  "action",
  "background",
  "cite",
  "data",
  "formaction",
  "href",
  "imagesrcset",
  "poster",
  "src",
  "srcset",
  "xlink:href",
]);

function portablePathSegment(segment) {
  const windowsBaseName = (segment.split(".", 1)[0] ?? "").trimEnd().toUpperCase();
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !segment.startsWith(".") &&
    segment.toLowerCase() !== "node_modules" &&
    !/[. ]$/u.test(segment) &&
    !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(windowsBaseName)
  );
}

export function isSafeHtmlImportPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !value.startsWith("/") &&
    !value.includes(":") &&
    !value.includes("\\") &&
    !value.includes("?") &&
    !value.includes("#") &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    /\.html?$/iu.test(value) &&
    value.split("/").every(portablePathSegment)
  );
}

export function resolveHtmlStylesheetPath(sourcePath, href) {
  if (!isSafeHtmlImportPath(sourcePath) || typeof href !== "string") return null;
  let decoded;
  try {
    decoded = decodeURIComponent(href.trim().split(/[?#]/u, 1)[0] ?? "");
  } catch {
    return null;
  }
  if (
    !decoded ||
    decoded.startsWith("/") ||
    decoded.startsWith("//") ||
    decoded.includes(":") ||
    decoded.includes("\\") ||
    !/\.css$/iu.test(decoded)
  ) {
    return null;
  }
  const segments = sourcePath.split("/");
  segments.pop();
  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    if (!portablePathSegment(segment)) return null;
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join("/") : null;
}

export function sanitizeHtmlCaptureCss(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*'|[^;]+)\s*;/giu, "")
    .replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/giu, "none");
}

function sourceByteLength(value) {
  return new TextEncoder().encode(value).length;
}

function sanitizeElementAttributes(element) {
  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase();
    if (
      name.startsWith("on") ||
      RESOURCE_ATTRIBUTES.has(name) ||
      ["autofocus", "form", "http-equiv", "integrity", "nonce"].includes(name)
    ) {
      element.removeAttribute(attribute.name);
      continue;
    }
    if (name === "style") {
      element.setAttribute("style", sanitizeHtmlCaptureCss(attribute.value));
    }
  }
}

async function sanitizedHtmlSource(sourcePath, html, readText) {
  if (typeof html !== "string" || sourceByteLength(html) > MAX_HTML_SOURCE_BYTES) {
    throw new Error("HTML 文件超过 512 KiB 导入上限");
  }
  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, "text/html");
  const title = parsed.querySelector("title")?.textContent?.trim() || sourcePath.split("/").at(-1);
  const styleSources = [...parsed.querySelectorAll('style, link[rel~="stylesheet" i]')];
  if (styleSources.filter((element) => element.tagName.toLowerCase() === "link").length > 20) {
    throw new Error(`HTML 最多引用 ${MAX_LINKED_STYLESHEETS} 个本地样式表`);
  }
  let totalBytes = sourceByteLength(html);
  for (const source of styleSources) {
    if (source.tagName.toLowerCase() === "style") {
      source.textContent = sanitizeHtmlCaptureCss(source.textContent ?? "");
      continue;
    }
    const path = resolveHtmlStylesheetPath(sourcePath, source.getAttribute("href") ?? "");
    if (!path) {
      source.remove();
      continue;
    }
    const result = await readText(path);
    const css = typeof result === "string" ? result : result?.content;
    if (typeof css !== "string") throw new Error(`无法读取 HTML 样式表：${path}`);
    totalBytes += sourceByteLength(css);
    if (totalBytes > MAX_HTML_SOURCE_BYTES) {
      throw new Error("HTML 与样式表合计超过 512 KiB 导入上限");
    }
    const style = parsed.createElement("style");
    style.dataset.captureSource = path;
    style.textContent = sanitizeHtmlCaptureCss(css);
    source.replaceWith(style);
  }

  parsed.querySelectorAll(BLOCKED_ELEMENTS).forEach((element) => element.remove());
  parsed.querySelectorAll("meta[http-equiv]").forEach((element) => element.remove());
  parsed.querySelectorAll("*").forEach(sanitizeElementAttributes);
  const freeze = parsed.createElement("style");
  freeze.dataset.codeshellCapture = "true";
  freeze.textContent =
    "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
  parsed.head.append(freeze);
  return {
    title,
    source: `<!doctype html>\n${parsed.documentElement.outerHTML}`,
  };
}

function captureFrame(viewportWidth, viewportHeight) {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = [
    "position:fixed",
    "left:-20000px",
    "top:0",
    `width:${viewportWidth}px`,
    `height:${viewportHeight}px`,
    "border:0",
    "opacity:0",
    "pointer-events:none",
  ].join(";");
  return frame;
}

function waitForFrameLoad(frame) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("HTML 预览加载超时")), 5_000);
    frame.addEventListener(
      "load",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    frame.addEventListener(
      "error",
      () => {
        window.clearTimeout(timer);
        reject(new Error("HTML 预览加载失败"));
      },
      { once: true },
    );
  });
}

export async function captureWorkspaceHtml({
  sourcePath,
  html,
  readText,
  rootSelector = "body",
  viewportWidth = 1440,
  viewportHeight = 900,
  name,
}) {
  if (!isSafeHtmlImportPath(sourcePath)) {
    throw new Error("HTML 路径必须是工作区内安全的相对 .html 文件");
  }
  if (typeof readText !== "function") throw new Error("HTML 导入缺少工作区读取能力");
  if (
    typeof rootSelector !== "string" ||
    !rootSelector.trim() ||
    rootSelector.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(rootSelector)
  ) {
    throw new Error("HTML 根选择器必须是 1–200 个安全字符");
  }
  for (const [label, value] of [
    ["宽度", viewportWidth],
    ["高度", viewportHeight],
  ]) {
    if (!Number.isInteger(value) || value < 100 || value > 10_000) {
      throw new Error(`HTML 视口${label}必须是 100 到 10000 的整数`);
    }
  }

  const prepared = await sanitizedHtmlSource(sourcePath, html, readText);
  const frame = captureFrame(viewportWidth, viewportHeight);
  const loaded = waitForFrameLoad(frame);
  frame.srcdoc = prepared.source;
  document.body.append(frame);
  try {
    await loaded;
    const frameDocument = frame.contentDocument;
    if (!frameDocument) throw new Error("浏览器没有提供可读取的 HTML 预览");
    const frameWindow = frame.contentWindow;
    if (!frameWindow) throw new Error("浏览器没有提供可读取的 HTML 预览窗口");
    await frameDocument.fonts?.ready;
    await new Promise((resolve) =>
      frameWindow.requestAnimationFrame(() => frameWindow.requestAnimationFrame(resolve)),
    );
    let root;
    try {
      root = frameDocument.querySelector(rootSelector.trim());
    } catch {
      throw new Error(`HTML 根选择器无效：${rootSelector}`);
    }
    if (!root) throw new Error(`HTML 中找不到根节点：${rootSelector}`);
    return await captureHtmlToDesign(root, {
      name: String(name || prepared.title || "HTML import").slice(0, 120),
    });
  } finally {
    frame.remove();
  }
}
