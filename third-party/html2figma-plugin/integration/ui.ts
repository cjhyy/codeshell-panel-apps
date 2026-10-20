// Offline replacement for upstream HtmlImport/JsonImport UI and API transport.
declare const __CAPTURE_RUNTIME__: string;
import { createHtmlAssetResolver } from "../../../apps/design-studio/app/html-import-assets.mjs";
import { resolveHtmlStylesheetPath } from "../../../apps/design-studio/app/html-import.mjs";
import { prepareDesignInput, inertDesignSvg } from "./input";
const $ = (id: string): any => document.getElementById(id);
let generation = 0,
  ready: any = null,
  busy = false,
  waiting = "";
let localFiles = new Map<string, File>();
let sourcePath = "pasted.html";
const size = (text: string) => new TextEncoder().encode(text).length;
function status(text: string, error = false) {
  $("status").textContent = text;
  $("status").dataset.error = String(error);
}
function controls(value: boolean) {
  busy = value;
  document.body.setAttribute("aria-busy", String(value));
  for (const id of [
    "source",
    "source-file",
    "folder",
    "html-files",
    "width",
    "height",
    "mode",
    "selector",
    "preview",
    "sample",
  ])
    $(id).disabled = value;
  $("create").disabled = value || !ready;
  $("download").disabled = value || !ready;
}
function invalidate() {
  generation++;
  ready = null;
  $("create").disabled = true;
  $("download").disabled = true;
  $("preview-stage").replaceChildren();
  status("内容已变更，请重新预览。");
}
for (const id of ["source", "width", "height", "mode", "selector"])
  $(id).addEventListener("input", invalidate);
const example =
  "<!doctype html><html><head><title>Launch</title><style>body{margin:0;background:#eef2ff;font-family:Arial,sans-serif;padding:48px}section{background:white;border-radius:24px;padding:36px;box-shadow:0 12px 36px #243b5a14}h1{font-size:38px;margin:0 0 18px;color:#172554}p{color:#475569;font-size:18px}button{background:#2563eb;color:white;border:0;border-radius:10px;padding:14px 24px;font-size:16px}</style></head><body><section><h1>从 HTML 到可编辑设计</h1><p>保留文字、布局、颜色和层级，继续在 Figma 中设计。</p><button>开始设计</button></section></body></html>";
$("sample").onclick = () => {
  $("source").value = example;
  $("mode").value = "html";
  sourcePath = "sample.html";
  invalidate();
};
$("source-file").onchange = async () => {
  const file = $("source-file").files[0];
  if (!file) return;
  invalidate();
  controls(true);
  try {
    if (file.size > 12 * 1024 * 1024) throw new Error("文件最多 12 MiB");
    $("source").value = await file.text();
    sourcePath = file.name;
    $("mode").value = /\.json$/i.test(file.name) ? "json" : "html";
  } catch (error: any) {
    status(error.message, true);
  } finally {
    controls(false);
  }
};
async function selectLocalHtml() {
  sourcePath = $("html-files").value;
  const file = localFiles.get(sourcePath);
  if (!file) throw new Error("所选文件夹没有 HTML 文件");
  if (file.size > 512 * 1024) throw new Error("HTML 最多 512 KiB");
  $("source").value = await file.text();
  $("mode").value = "html";
}
$("folder").onchange = async () => {
  invalidate();
  controls(true);
  try {
    const files = Array.from($("folder").files as FileList);
    if (files.length > 2000) throw new Error("最多选择 2000 个本地文件，请选择更小的 HTML 文件夹");
    localFiles = new Map(files.map((f) => [f.webkitRelativePath || f.name, f]));
    $("html-files").replaceChildren();
    for (const [path] of localFiles)
      if (/\.html?$/i.test(path)) {
        const option = document.createElement("option");
        option.value = path;
        option.textContent = path;
        $("html-files").append(option);
      }
    $("html-files").hidden = !$("html-files").options.length;
    await selectLocalHtml();
  } catch (error: any) {
    status(error.message, true);
  } finally {
    controls(false);
  }
};
$("html-files").onchange = async () => {
  invalidate();
  controls(true);
  try {
    await selectLocalHtml();
  } catch (error: any) {
    status(error.message, true);
  } finally {
    controls(false);
  }
};
async function asset(path: string) {
  const file = localFiles.get(path);
  if (!file) throw new Error(`请一起选择本地资源：${path}`);
  if (file.size > 8 * 1024 * 1024) throw new Error("单个图片/字体最多 8 MiB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let raw = "";
  for (let i = 0; i < bytes.length; i += 8192)
    raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { base64: btoa(raw) };
}
async function staticHtml(
  html: string,
  captureOptions: { requestId: string; selector: string },
  nonce: string,
) {
  if (size(html) > 512 * 1024) throw new Error("HTML 与 CSS 合计最多 512 KiB");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const resolver = createHtmlAssetResolver({ readAsset: asset });
  let bytes = size(html);
  const links = [...parsed.querySelectorAll('link[rel~="stylesheet" i]')];
  if (links.length > 20) throw new Error("最多 20 个本地样式表");
  for (const link of links) {
    const path = resolveHtmlStylesheetPath(sourcePath, link.getAttribute("href") || "");
    if (!path) {
      link.remove();
      continue;
    }
    const file = localFiles.get(path);
    if (!file) throw new Error(`请一起选择本地样式表：${path}`);
    if (file.size > 512 * 1024) throw new Error("HTML 与 CSS 合计最多 512 KiB");
    const css = await file.text();
    bytes += size(css);
    if (bytes > 512 * 1024) throw new Error("HTML 与 CSS 合计最多 512 KiB");
    const style = parsed.createElement("style");
    style.textContent = await resolver.css(css, path);
    link.replaceWith(style);
  }
  parsed
    .querySelectorAll(
      "script,noscript,iframe,frame,frameset,object,embed,portal,applet,base,meta[http-equiv],link",
    )
    .forEach((n) => n.remove());
  for (const style of parsed.querySelectorAll("style"))
    style.textContent = await resolver.css(style.textContent || "", sourcePath);
  for (const element of parsed.querySelectorAll("*")) {
    if (element.hasAttribute("style"))
      element.setAttribute(
        "style",
        await resolver.css(element.getAttribute("style") || "", sourcePath),
      );
    for (const attr of [...element.attributes]) {
      const key = attr.name.toLowerCase();
      if (
        ["src", "href", "xlink:href"].includes(key) &&
        ["IMG", "image"].includes(element.tagName)
      ) {
        const data = await resolver.resolve(attr.value, sourcePath);
        if (data) element.setAttribute(attr.name, data);
        else element.removeAttribute(attr.name);
      } else if ((key === "href" || key === "xlink:href") && /^#[a-z][\w:.-]*$/i.test(attr.value))
        continue;
      else if (
        key.startsWith("on") ||
        [
          "src",
          "href",
          "xlink:href",
          "srcset",
          "imagesrcset",
          "action",
          "formaction",
          "background",
          "poster",
          "data",
          "cite",
          "autofocus",
          "form",
          "http-equiv",
          "nonce",
          "integrity",
        ].includes(key)
      )
        element.removeAttribute(attr.name);
    }
  }
  for (const svg of parsed.querySelectorAll("svg")) inertDesignSvg(svg.outerHTML);
  const policy = parsed.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'`;
  parsed.head.prepend(policy);
  const freeze = parsed.createElement("style");
  freeze.textContent =
    "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}html{scrollbar-width:none}";
  parsed.head.append(freeze);
  const script = parsed.createElement("script");
  script.setAttribute("nonce", nonce);
  script.textContent = (
    `const __captureOptions = ${JSON.stringify(captureOptions)};\n` + __CAPTURE_RUNTIME__
  ).replace(/<\/script/gi, "<\\/script");
  parsed.body.append(script);
  return {
    source: `<!doctype html>${parsed.documentElement.outerHTML}`,
    warnings: resolver.warnings.map((w) => w.message),
  };
}
function dimensions() {
  const width = Number($("width").value),
    height = Number($("height").value);
  if (![width, height].every((n) => Number.isInteger(n) && n >= 100 && n <= 10000))
    throw new Error("画布宽高须为 100–10000 的整数");
  return { width, height };
}
function fit(element: HTMLElement, width: number, height: number) {
  const scale = Math.min(1, ($("preview-stage").clientWidth - 4) / width, 350 / height);
  element.style.cssText += `;width:${width}px;height:${height}px;transform:scale(${scale});transform-origin:top left;`;
  $("preview-stage").style.height = `${height * scale + 4}px`;
  $("preview-stage").append(element);
}
function jsonPreview(roots: any[]) {
  const scene = document.createElement("div");
  scene.style.cssText = "position:relative;background:white;overflow:hidden;";
  function render(node: any, parent: HTMLElement) {
    const div = document.createElement("div");
    const fill = node.fills?.find((f) => f.type === "SOLID");
    div.style.cssText = `position:absolute;box-sizing:border-box;left:${Number(node.x) || 0}px;top:${Number(node.y) || 0}px;width:${node.width}px;height:${node.height}px;opacity:${node.opacity ?? 1};overflow:${node.clipsContent ? "hidden" : "visible"};border-radius:${Number(node.cornerRadius) || 0}px;`;
    if (fill?.color) {
      const c = fill.color;
      div.style.background = `rgba(${c.r * 255},${c.g * 255},${c.b * 255},${fill.opacity ?? 1})`;
    }
    if (node.type === "TEXT") {
      div.textContent = node.characters;
      div.style.fontSize = `${node.fontSize || 16}px`;
      div.style.whiteSpace = "pre-wrap";
      if (fill?.color) {
        div.style.color = div.style.background;
        div.style.background = "transparent";
      }
    }
    parent.append(div);
    for (const child of node.children ?? []) render(child, div);
  }
  const first = roots[0];
  render({ ...first, x: 0, y: 0 }, scene);
  fit(scene, first.width, first.height);
}
$("preview").onclick = async () => {
  if (busy) return;
  const current = generation;
  controls(true);
  ready = null;
  $("preview-stage").replaceChildren();
  status("正在准备预览…");
  try {
    const content = $("source").value;
    if (!content.trim()) throw new Error("请粘贴内容或选择文件");
    let input,
      warnings = [];
    if ($("mode").value === "html") {
      const { width, height } = dimensions();
      const requestId = [...crypto.getRandomValues(new Uint8Array(16))]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
      const selector = $("selector").value.trim() || "body";
      if (selector.length > 200) throw new Error("根选择器最多 200 字符");
      const prepared = await staticHtml(content, { requestId, selector }, requestId);
      warnings = prepared.warnings;
      const frame = document.createElement("iframe");
      frame.title = "静态 HTML 预览";
      frame.setAttribute("sandbox", "allow-scripts");
      frame.style.cssText = "border:0;pointer-events:none;background:white;";
      input = await new Promise((resolve, reject) => {
        const receive = (event: MessageEvent) => {
          if (
            event.source !== frame.contentWindow ||
            event.data?.type !== "html2figma-captured" ||
            event.data.requestId !== requestId
          )
            return;
          clearTimeout(timer);
          window.removeEventListener("message", receive);
          if (event.data.error) reject(new Error(event.data.error));
          else resolve(event.data.tree);
        };
        const timer = setTimeout(() => {
          window.removeEventListener("message", receive);
          reject(new Error("预览转换超时"));
        }, 10000);
        window.addEventListener("message", receive);
        frame.srcdoc = prepared.source;
        fit(frame, width, height);
      });
    } else input = content;
    const prepared = prepareDesignInput(input);
    if ($("mode").value === "json") jsonPreview(prepared.roots);
    if (generation !== current) return;
    ready = prepared;
    ready.warnings = [...warnings, ...prepared.warnings];
    status(
      `预览完成 · ${ready.count} 个图层 · ${ready.roots.length} 个根节点${ready.warnings.length ? "\n" + ready.warnings.join("\n") : ""}`,
    );
  } catch (error: any) {
    ready = null;
    status(error.message || String(error), true);
  } finally {
    controls(false);
  }
};
$("create").onclick = () => {
  if (!ready || busy) return;
  waiting = `html-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  controls(true);
  status("正在 Figma 中创建图层…");
  parent.postMessage(
    { pluginMessage: { type: "import-design", requestId: waiting, designData: ready.roots } },
    "*",
  );
};
$("download").onclick = () => {
  if (!ready || busy) return;
  const a = document.createElement("a");
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(ready.roots, null, 2)], { type: "application/json" }),
  );
  a.href = url;
  a.download = "codeshell-html2figma.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener("message", (event) => {
  if (
    event.source !== parent &&
    !["https://www.figma.com", "https://figma.com"].includes(event.origin)
  )
    return;
  const message = event.data?.pluginMessage;
  if (
    !waiting ||
    message?.requestId !== waiting ||
    !["import-success", "import-error"].includes(message.type)
  )
    return;
  waiting = "";
  controls(false);
  status(
    message.type === "import-success"
      ? `已在 Figma 创建 ${message.count} 个可编辑图层${message.warnings?.length ? "\n" + message.warnings.join("\n") : ""}`
      : message.message,
    message.type === "import-error",
  );
});
controls(false);
