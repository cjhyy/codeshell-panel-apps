/* Resolve only explicitly selected local files and inline data; never fetch a URL. */
import { imageMimeFromBytes } from "./image-mime.mjs";
import { parseDesignFontFamily } from "./font-family.mjs";

const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const MIMES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["svg", "image/svg+xml"],
  ["woff2", "font/woff2"],
  ["woff", "font/woff"],
  ["ttf", "font/ttf"],
  ["otf", "font/otf"],
]);
const DATA =
  /^data:((?:image\/(?:png|jpeg|gif|webp|svg\+xml))|(?:font\/(?:woff2?|ttf|otf)));base64,([A-Za-z0-9+/]*={0,2})$/iu;

export function resolveHtmlAssetPath(sourcePath, reference) {
  if (typeof reference !== "string" || /[\u0000-\u001f\u007f\\]/u.test(reference)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(reference.trim().split(/[?#]/u, 1)[0]);
  } catch {
    return null;
  }
  if (!decoded || decoded.startsWith("/") || decoded.includes(":")) return null;
  const parts = sourcePath.split("/").slice(0, -1);
  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (segment.startsWith(".") || /[. ]$/u.test(segment) || segment === "node_modules")
      return null;
    else parts.push(segment);
  }
  return parts.length ? parts.join("/") : null;
}

export function safeHtmlDataUrl(value) {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_ASSET_BYTES / 3) * 4 + 100)
    return false;
  const match = DATA.exec(value);
  return Boolean(match && match[2].length && match[2].length % 4 === 0);
}

export function createHtmlAssetResolver({ readAsset, warnings = [] } = {}) {
  let totalBytes = 0;
  const cache = new Map();
  const counted = new Set();
  const account = (value) => {
    let dataUrl = value;
    if (!safeHtmlDataUrl(dataUrl))
      throw new Error("HTML 资源必须是受支持的内嵌图片或字体，单项最多 8 MiB");
    const [, declaredMime, base64] = DATA.exec(dataUrl);
    const byteLength =
      (base64.length / 4) * 3 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
    if (byteLength > MAX_ASSET_BYTES) throw new Error("HTML 本地资源超过 8 MiB");
    if (declaredMime.toLowerCase().startsWith("image/")) {
      const binary = atob(base64),
        bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      const mime = imageMimeFromBytes(bytes);
      if (!mime)
        throw new Error("HTML 图片无法解码：图片字节不是受支持的 PNG、JPEG、GIF、WebP 或 SVG");
      if ((declaredMime.toLowerCase() === "image/svg+xml") !== (mime === "image/svg+xml"))
        throw new Error("HTML 图片的 SVG 类型声明与实际字节不一致，未改变浏览器的解码语义");
      // Supported raster MIME aliases follow bytes; SVG decoding remains distinct.
      dataUrl = `data:${mime};base64,${base64}`;
    }
    if (!counted.has(dataUrl)) {
      if (totalBytes + byteLength > MAX_TOTAL_BYTES)
        throw new Error("HTML 图片和字体合计超过 12 MiB，请分页面导入");
      totalBytes += byteLength;
      counted.add(dataUrl);
    }
    return dataUrl;
  };
  const resolve = async (reference, sourcePath) => {
    const value = String(reference ?? "").trim();
    if (/^data:image\/svg\+xml(?:;charset=utf-8)?,/iu.test(value)) {
      let svg;
      try {
        svg = decodeURIComponent(value.slice(value.indexOf(",") + 1));
      } catch {
        throw new Error("SVG 内嵌资源编码无效");
      }
      const bytes = new TextEncoder().encode(svg);
      if (bytes.length > MAX_ASSET_BYTES) throw new Error("SVG 内嵌资源超过 8 MiB");
      let binary = "";
      for (let index = 0; index < bytes.length; index += 32768)
        binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
      return account(`data:image/svg+xml;base64,${btoa(binary)}`);
    }
    if (value.startsWith("data:")) return account(value);
    if (value.startsWith("#")) return value;
    const path = resolveHtmlAssetPath(sourcePath, value);
    if (!path) {
      if (value)
        warnings.push({
          code: "external-resource-blocked",
          message: `未加载外部资源：${value.slice(0, 160)}`,
        });
      return null;
    }
    if (typeof readAsset !== "function")
      throw new Error(`HTML 引用了本地二进制资源 ${path}；请用「选择 HTML 文件夹」一起导入`);
    if (!cache.has(path))
      cache.set(
        path,
        (async () => {
          const asset = await readAsset(path);
          const mime = MIMES.get(path.split(".").at(-1).toLowerCase());
          if (!asset || !mime) throw new Error(`没有受支持的本地 HTML 资源：${path}`);
          const dataUrl = typeof asset === "string" ? asset : `data:${mime};base64,${asset.base64}`;
          return account(dataUrl);
        })(),
      );
    return cache.get(path);
  };
  const css = async (source, sourcePath) => {
    if (/@import\s/iu.test(source))
      warnings.push({
        code: "stylesheet-import-skipped",
        message: `${sourcePath} 中的 CSS @import 未加载；请使用 HTML 的本地 link 样式表。`,
      });
    const withoutImports = source.replace(
      /@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*'|[^;]+)\s*;/giu,
      "",
    );
    const matches = [...withoutImports.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/giu)];
    let output = "",
      cursor = 0;
    for (const match of matches) {
      output += withoutImports.slice(cursor, match.index);
      const data = await resolve(match[1] ?? match[2] ?? match[3], sourcePath);
      output += data ? `url("${data}")` : "none";
      cursor = match.index + match[0].length;
    }
    return output + withoutImports.slice(cursor);
  };
  return { resolve, css, warnings, dataUrls: () => [...counted] };
}

export function htmlFontResources(css, warnings = []) {
  const fonts = [];
  for (const match of css.matchAll(/@font-face\s*\{([^}]+)\}/giu)) {
    const rule = match[1];
    const property = (name) =>
      new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "iu").exec(rule)?.[1]?.trim();
    const families = parseDesignFontFamily(property("font-family"));
    const family = families?.length === 1 && !families[0].generic ? families[0].name : null;
    const source = /url\(["']?(data:font\/(?:woff2?|ttf|otf);base64,[A-Za-z0-9+/=]+)["']?\)/iu.exec(
      rule,
    )?.[1];
    const rawWeight = property("font-weight") ?? "400";
    const weight = rawWeight === "normal" ? 400 : rawWeight === "bold" ? 700 : Number(rawWeight),
      style = property("font-style") ?? "normal";
    if (
      family &&
      source &&
      Number.isInteger(weight) &&
      weight >= 1 &&
      weight <= 1000 &&
      ["normal", "italic", "oblique"].includes(style)
    ) {
      const [, mime, base64] = DATA.exec(source);
      fonts.push({ family, weight, style, mime, base64 });
    } else
      warnings.push({
        code: "font-face-unsupported",
        message: "一项 @font-face 的字体名、字重、样式或资源无法映射到 v3；该字体声明未归档。",
      });
  }
  return fonts;
}

export function selectedHtmlFiles(files) {
  const result = new Map();
  for (const file of files) {
    const raw = file.webkitRelativePath || file.name;
    const path = file.webkitRelativePath ? raw.split("/").slice(1).join("/") : raw;
    if (
      !path ||
      path.startsWith(".") ||
      path
        .split("/")
        .some((part) => part === ".." || part === "node_modules" || part.startsWith("."))
    )
      continue;
    if (result.has(path)) throw new Error(`本地文件路径重复：${path}`);
    result.set(path, file);
    if (result.size > 2048) throw new Error("一次最多选择 2048 个 HTML 及资源文件");
  }
  return result;
}

export async function readSelectedHtmlAsset(file) {
  if (!file || file.size < 1 || file.size > MAX_ASSET_BYTES)
    throw new Error("HTML 本地资源缺失或超过 8 MiB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 32768)
    binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
  return { base64: btoa(binary) };
}
