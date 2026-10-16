import { captureHtmlToDesign } from "./html-capture.mjs";
import { convertToDesignDSL, HTML2FIGMA_PROVENANCE } from "./vendor/html2figma-browser.mjs";
import { designNodeToV3 } from "./design-node-adapter.mjs";
import {
  createHtmlAssetResolver,
  htmlFontResources,
  safeHtmlDataUrl,
} from "./html-import-assets.mjs";

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
      (name === "src" || name === "href" || name === "xlink:href") &&
      safeHtmlDataUrl(attribute.value)
    )
      continue;
    if ((name === "href" || name === "xlink:href") && /^#[a-z][\w:.-]*$/iu.test(attribute.value))
      continue;
    if (
      name.startsWith("on") ||
      RESOURCE_ATTRIBUTES.has(name) ||
      ["autofocus", "form", "http-equiv", "integrity", "nonce"].includes(name)
    ) {
      element.removeAttribute(attribute.name);
      continue;
    }
  }
}

async function sanitizedHtmlSource(sourcePath, html, readText, readAsset) {
  if (typeof html !== "string" || sourceByteLength(html) > MAX_HTML_SOURCE_BYTES) {
    throw new Error("HTML 文件超过 512 KiB 导入上限");
  }
  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, "text/html");
  const assets = createHtmlAssetResolver({ readAsset });
  const fonts = [];
  const title = parsed.querySelector("title")?.textContent?.trim() || sourcePath.split("/").at(-1);
  const styleSources = [...parsed.querySelectorAll('style, link[rel~="stylesheet" i]')];
  if (styleSources.filter((element) => element.tagName.toLowerCase() === "link").length > 20) {
    throw new Error(`HTML 最多引用 ${MAX_LINKED_STYLESHEETS} 个本地样式表`);
  }
  let totalBytes = sourceByteLength(html);
  for (const source of styleSources) {
    if (source.tagName.toLowerCase() === "style") {
      source.textContent = await assets.css(source.textContent ?? "", sourcePath);
      fonts.push(...htmlFontResources(source.textContent, assets.warnings));
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
    style.textContent = await assets.css(css, path);
    fonts.push(...htmlFontResources(style.textContent, assets.warnings));
    source.replaceWith(style);
  }

  parsed.querySelectorAll(BLOCKED_ELEMENTS).forEach((element) => element.remove());
  parsed.querySelectorAll("meta[http-equiv]").forEach((element) => element.remove());
  for (const element of parsed.querySelectorAll("img, image")) {
    const attribute = element.hasAttribute("src")
      ? "src"
      : element.hasAttribute("href")
        ? "href"
        : "xlink:href";
    const value = element.getAttribute(attribute);
    if (value) {
      const resolved = await assets.resolve(value, sourcePath);
      if (resolved) element.setAttribute(attribute, resolved);
      else element.removeAttribute(attribute);
    }
  }
  for (const element of parsed.querySelectorAll("[style]")) {
    element.setAttribute("style", await assets.css(element.getAttribute("style"), sourcePath));
  }
  parsed.querySelectorAll("*").forEach(sanitizeElementAttributes);
  const policy = parsed.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'";
  parsed.head.prepend(policy);
  const freeze = parsed.createElement("style");
  freeze.dataset.codeshellCapture = "true";
  freeze.textContent =
    "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
  parsed.head.append(freeze);
  return {
    title,
    fonts,
    dataUrls: assets.dataUrls(),
    warnings: assets.warnings,
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

async function verifyHtmlResources(frameWindow, prepared) {
  const checks = [];
  for (const dataUrl of prepared.dataUrls) {
    if (dataUrl.startsWith("data:font/")) {
      const face = new frameWindow.FontFace("CodeShellImportVerification", `url(${dataUrl})`);
      checks.push(
        face.load().catch((error) => {
          throw new Error("HTML 字体资源无法解码", { cause: error });
        }),
      );
      continue;
    }
    if (!dataUrl.startsWith("data:image/")) continue;
    const image = new frameWindow.Image();
    image.src = dataUrl;
    checks.push(
      image
        .decode()
        .then(() => {
          if (
            image.naturalWidth > 8192 ||
            image.naturalHeight > 8192 ||
            image.naturalWidth * image.naturalHeight > 16_777_216
          )
            throw new Error("HTML 图片像素过大；单张最多 8192 像素边长及 1600 万像素");
        })
        .catch((error) => {
          throw new Error("HTML 图片无法解码或超出像素上限", { cause: error });
        }),
    );
  }
  let timer;
  try {
    await Promise.race([
      Promise.all(checks),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("HTML 资源验证超时")), 5000);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

export async function captureWorkspaceHtmlResult({
  sourcePath,
  html,
  readText,
  readAsset,
  rootSelector = "html",
  viewportWidth = 1440,
  viewportHeight = 900,
  name,
  sha256Bytes,
  engine = "html2figma",
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

  if (!["html2figma", "measured"].includes(engine)) throw new Error("未知 HTML 转换引擎");
  const prepared = await sanitizedHtmlSource(sourcePath, html, readText, readAsset);
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
    await verifyHtmlResources(frameWindow, prepared);
    await frameDocument.fonts?.ready;
    await Promise.all(
      [...frameDocument.images]
        .filter((image) => image.hasAttribute("src"))
        .map((image) =>
          image.decode().catch(() => {
            throw new Error("HTML 图片无法解码，请检查资源内容");
          }),
        ),
    );
    for (const image of frameDocument.images) {
      if (
        image.naturalWidth > 8192 ||
        image.naturalHeight > 8192 ||
        image.naturalWidth * image.naturalHeight > 16_777_216
      )
        throw new Error("HTML 图片像素过大；单张最多 8192 像素边长及 1600 万像素");
    }
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
    const options = {
      name: String(name || prepared.title || "HTML import").slice(0, 120),
      viewportWidth,
      viewportHeight,
      sha256Bytes,
      fonts: prepared.fonts,
      captureBounds: {
        left: 0,
        top: 0,
        right: viewportWidth,
        bottom: viewportHeight,
      },
    };
    if (engine === "measured")
      return {
        document: await captureHtmlToDesign(root, options),
        resourcePlans: [],
        report: { engine, warnings: prepared.warnings },
      };
    const tree = convertToDesignDSL(root);
    if (!tree) throw new Error("html2figma 没有生成可见 DesignNode");
    const result = await designNodeToV3(tree, options);
    result.report = {
      ...result.report,
      engine,
      upstreamCommit: HTML2FIGMA_PROVENANCE.upstreamCommit,
      warnings: [...prepared.warnings, ...(result.report?.warnings ?? [])],
    };
    return result;
  } finally {
    frame.remove();
  }
}

/** Compatibility API used by document comparison; imports use the full result including assets. */
export async function captureWorkspaceHtml(options) {
  return (await captureWorkspaceHtmlResult(options)).document;
}
