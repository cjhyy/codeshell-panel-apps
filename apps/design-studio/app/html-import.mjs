import { captureHtmlToDesign, hangingBaselineOffset, parseCssColor } from "./html-capture.mjs";
import { captureHtmlViewportRelation } from "./html-viewport-flow.mjs";
import { convertToDesignDSL, HTML2FIGMA_PROVENANCE } from "./vendor/html2figma-browser.mjs";
import { designNodeToV3 } from "./design-node-adapter.mjs";
import { measureFigmaTextDocument } from "./text-metrics.mjs";
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

function alignHtmlTextBaselines(documentValue, browserDocument) {
  const visit = (node) => {
    if (node.type === "text") {
      // html2figma preserves browser Range bounds. Convert just these new HTML
      // text origins to the hanging-baseline convention already used by v3.
      const offset = hangingBaselineOffset(
        node,
        node.fontSize,
        node.letterSpacing ?? 0,
        browserDocument,
      );
      const y = Math.min(20000, Math.max(-20000, node.y + offset));
      node.layoutBaselineOffset = Math.round(((node.layoutBaselineOffset ?? 0) + y - node.y) * 10000) / 10000;
      node.y = Math.round(y * 100) / 100;
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const page of documentValue.pages) page.children.forEach(visit);
}

async function enableHtmlTextReflow(documentValue, browserDocument, elements, warn) {
  const promoted = [];
  const sourceNodes = new Map(),
    sourceIds = new Map();
  const visit = (node, parent) => {
    if (node.type === "text") {
      let intent;
      try { intent = JSON.parse(node.notes ?? "{}").htmlText; } catch {}
      if (intent) {
        promoted.push(node);
        if (node.textOverflow !== "ellipsis") {
          sourceNodes.set(node.id, { style: { textAutoResize: "WIDTH_AND_HEIGHT" } });
          sourceIds.set(node.id, node.id);
        }
      }
    }
    if (
      node.type === "frame" &&
      node.layout === "none" &&
      node.children?.length === 1 &&
      node.children[0].type === "text" &&
      !node.rotation
    ) {
      let element, semantic;
      try {
        semantic = JSON.parse(node.notes ?? "{}");
      } catch { /* Source metadata is optional; never guess by visible text. */ }
      const bound = elements.get(semantic?.semanticId);
      if (bound?.ownerDocument === browserDocument) element = bound;
      else {
        try {
          const selector = semantic?.cssSelector;
          if (selector) {
            const matches = browserDocument.querySelectorAll(selector);
            if (matches.length === 1) element = matches[0];
          }
        } catch { /* Missing, invalid or ambiguous selectors stay measured. */ }
        warn("html-text-source-binding", node.id,
          `${elements.has(semantic?.semanticId) ? "文字来源标识对应多个实际元素" : "文字来源没有唯一捕获绑定"}；${element ? "仅使用旧的唯一选择器来源" : "保留测量几何，不猜测第一个匹配项"}。`);
      }
      const text = node.children[0];
      const style = element && browserDocument.defaultView.getComputedStyle(element);
      // CSS normal collapses ASCII HTML whitespace, never NBSP or other Unicode
      // spacing. Keep the exact DOM string separately when it differs.
      const collapsed = (value) => value.replace(/[\t\n\f\r ]+/gu, " ").replace(/^ | $/gu, "");
      const rawSource = element?.textContent ?? "";
      const source = collapsed(rawSource);
      // Upstream normal text may replace NBSP with SPACE or append an NBSP
      // spacer. Compare that legacy shape only; the exact bound DOM source,
      // including every real NBSP, is what we retain and measure below.
      const legacyShape = (value) => collapsed(value.replace(/\u00a0/gu, " "));
      const ordinary = style && ["block", "inline-block"].includes(style.display) &&
        !element.matches("button,input,select,textarea,option") &&
        style.direction === "ltr" && style.visibility === "visible" && style.transform === "none" &&
        style.textTransform === "none" && ["normal", "0px"].includes(style.wordSpacing) &&
        ["::before", "::after"].every((pseudo) => ["none", "normal"].includes(
          browserDocument.defaultView.getComputedStyle(element, pseudo).content)) &&
        ["::first-line", "::first-letter"].every((pseudo) => {
          const variant = browserDocument.defaultView.getComputedStyle(element, pseudo);
          return ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "wordSpacing", "textTransform", "color", "textShadow"]
            .every((key) => variant[key] === style[key]);
        }) && node.visible !== false && text.visible !== false &&
        !(/[\r\n]/u.test(rawSource) && /[^\x00-\x7f]/u.test(rawSource));
      const childSemantic = JSON.parse(text.notes ?? "{}");
      const originalNotes = source !== rawSource
        ? JSON.stringify({ ...childSemantic, htmlTextOriginal: { whiteSpace: "normal", rawSource } })
        : text.notes;
      if (style && (!ordinary || (childSemantic.styledSegments?.length ?? 0) > 1))
        warn("html-plain-text-fixed", node.id, "表格/行内、表单控件、多样式、生成内容、隐藏或特殊文字样式不能恢复为单一普通文字 Auto Layout；保留测量几何。");
      if (
        style &&
        ordinary &&
        (childSemantic.styledSegments?.length ?? 0) <= 1 &&
        element.childElementCount === 0 &&
        style.whiteSpace === "normal" &&
        style.writingMode === "horizontal-tb" &&
        (Number.parseFloat(style.textIndent) || 0) === 0 &&
        ["Top", "Right", "Bottom", "Left"].every(
          (side) => (Number.parseFloat(style[`border${side}Width`]) || 0) === 0,
        ) &&
        source &&
        rawSource.length <= 4000 &&
        (originalNotes?.length ?? 0) <= 2000 &&
        legacyShape(source) === legacyShape(text.textSource ?? text.text) &&
        !text.rotation
      ) {
        const top = node.paddingTop ?? node.padding ?? 0;
        const left = node.paddingLeft ?? node.padding ?? 0;
        const right = node.paddingRight ?? node.padding ?? 0;
        const baseline = text.y - node.y - top;
        const lineHeight = Number.parseFloat(style.lineHeight);
        if (
          Math.abs(baseline) <= 100 &&
          Number.isFinite(lineHeight) &&
          lineHeight > 0 &&
          lineHeight / text.fontSize >= 0.7 &&
          lineHeight / text.fontSize <= 3
        ) {
          let cssWidth = "",
            cssHeight = "";
          try {
            cssWidth = element.computedStyleMap?.().get("width")?.toString() ?? "";
            cssHeight = element.computedStyleMap?.().get("height")?.toString() ?? "";
          } catch {
            // Engines without Typed OM keep the captured box sizing.
          }
          if (node.layoutSizingVertical !== "fill" && cssHeight === "auto")
            node.layoutSizingVertical = "hug";
          if (
            node.layoutSizingHorizontal !== "fill" &&
            ["auto", "min-content", "max-content", "fit-content"].includes(cssWidth) &&
            (parent?.layout === "horizontal" || ["inline", "inline-block"].includes(style.display))
          )
            node.layoutSizingHorizontal = "hug";
          Object.assign(node, {
            layout: "vertical",
            layoutWrap: "none",
            gap: 0,
            rowGap: 0,
            columnGap: 0,
            alignItems: "start",
            justifyContent: "start",
          });
          text.x = node.x + left;
          text.width =
            node.layoutSizingHorizontal === "hug"
              ? text.width
              : Math.max(1, node.width - left - right);
          text.lineHeight = lineHeight / text.fontSize;
          text.height = lineHeight * text.text.split("\n").length;
          text.textSource = source;
          if (originalNotes !== undefined) text.notes = originalNotes;
          text.textFlow = "wrap";
          text.textFlowWidth = text.width;
          text.layoutBaselineOffset = Math.round(baseline * 10000) / 10000;
          text.layoutSizingHorizontal = node.layoutSizingHorizontal === "hug" ? "hug" : "fill";
          text.layoutSizingVertical = "hug";
          text.layoutAlignSelf = "start";
          if (node.layoutSizingHorizontal === "hug") {
            delete text.textFlow;
            sourceNodes.set(text.id, { style: { textAutoResize: "WIDTH_AND_HEIGHT" } });
            sourceIds.set(text.id, text.id);
          }
          promoted.push(text);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, node);
  };
  for (const page of documentValue.pages) page.children.forEach((node) => visit(node, null));
  if (promoted.length) {
    await measureFigmaTextDocument(
      { nodes: promoted },
      { browserDocument, sourceNodes, sourceIds },
    );
    for (const text of promoted) {
      let intent;
      try { intent = JSON.parse(text.notes ?? "{}").htmlText; } catch {}
      if (intent && text.textOverflow !== "ellipsis" && text.textMetrics)
        text.width = Math.ceil(Math.max(1, ...text.textMetrics.lineWidths) * 100) / 100;
    }
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
  includeViewport = true,
}) {
  if (!isSafeHtmlImportPath(sourcePath)) {
    throw new Error("HTML 路径必须是工作区内安全的相对 .html 文件");
  }
  if (typeof readText !== "function") throw new Error("HTML 导入缺少工作区读取能力");
  if (typeof includeViewport !== "boolean") throw new Error("includeViewport 必须为布尔值");
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
      includeViewport,
      ...(includeViewport ? { captureBounds: {
        left: 0,
        top: 0,
        right: viewportWidth,
        bottom: viewportHeight,
      } } : {}),
    };
    if (engine === "measured")
      return {
        document: await captureHtmlToDesign(root, options),
        resourcePlans: [],
        report: { engine, warnings: prepared.warnings },
      };
    const elements = new Map();
    const tree = convertToDesignDSL(root, { onElement: (semanticId, element) => {
      if (element.ownerDocument !== frameDocument || !root.contains(element)) return;
      if (!elements.has(semanticId)) elements.set(semanticId, element);
      else if (elements.get(semanticId) !== element) elements.set(semanticId, null);
    } });
    if (!tree) throw new Error("html2figma 没有生成可见 DesignNode");
    if (includeViewport) {
      options.viewportRelation = captureHtmlViewportRelation(root);
      const htmlColor = parseCssColor(frameWindow.getComputedStyle(frameDocument.documentElement).backgroundColor);
      const bodyColor = frameDocument.body && parseCssColor(frameWindow.getComputedStyle(frameDocument.body).backgroundColor);
      const canvasColor = htmlColor?.alpha ? htmlColor : bodyColor;
      options.background = canvasColor?.alpha === 1 ? canvasColor.hex : "#ffffff";
    }
    const result = await designNodeToV3(tree, options);
    alignHtmlTextBaselines(result.document, frameDocument);
    await enableHtmlTextReflow(result.document, frameDocument, elements, (code, nodeId, message) => {
      result.report.stats.warningCount += 1;
      if (result.report.warnings.length < 500) result.report.warnings.push({ code, nodeId, message });
      else result.report.stats.omittedWarnings += 1;
    });
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
