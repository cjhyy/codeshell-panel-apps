/* Local file adapter. Shared Panel schemas are bundled into ui.html at build time. */
import { normalizeDesignDocument } from "../document.mjs";
import { createFigmaTransfer, MAX_FIGMA_JSON_BYTES } from "../figma-bridge.mjs";
import { normalizeFigmaAsset } from "../figma-assets.mjs";
import { planPortableDesign, MAX_PORTABLE_DESIGN_BYTES } from "../portable-backup.mjs";

export const MAX_PLUGIN_INPUT_BYTES = MAX_PORTABLE_DESIGN_BYTES;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const encoder = new TextEncoder();
const length = (value) => encoder.encode(value).length;

// WebCrypto is preferred. The FIPS 180-4 fallback also works in opaque plugin
// iframes that do not expose SubtleCrypto; it never needs a network dependency.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotate = (x, count) => (x >>> count) | (x << (32 - count));
export async function sha256PluginBytes(input, { subtle = globalThis.crypto?.subtle } = {}) {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (subtle) {
    const digest = await subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(data.length / 0x20000000));
  view.setUint32(padded.length - 4, (data.length * 8) >>> 0);
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index++) {
      const x = words[index - 15],
        y = words[index - 2];
      words[index] =
        (words[index - 16] +
          (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) +
          words[index - 7] +
          (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10))) >>>
        0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index++) {
      const first =
        (h +
          (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
          ((e & f) ^ (~e & g)) +
          K[index] +
          words[index]) >>>
        0;
      const second =
        ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }
    for (const [index, value] of [a, b, c, d, e, f, g, h].entries())
      state[index] = (state[index] + value) >>> 0;
  }
  return [...state].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function assertFontMime(descriptor, base64) {
  const prefix = atob(base64.slice(0, 16));
  const signature = prefix.slice(0, 4);
  const valid = ["font/woff", "application/font-woff"].includes(descriptor.mime)
    ? signature === "wOFF"
    : descriptor.mime === "font/woff2"
      ? signature === "wOF2"
      : ["font/otf", "application/x-font-opentype"].includes(descriptor.mime)
        ? signature === "OTTO"
        : ["font/ttf", "application/x-font-ttf"].includes(descriptor.mime)
          ? signature === "\u0000\u0001\u0000\u0000" || signature === "true" || signature === "ttcf"
          : false;
  if (!valid) throw Error(`字体资源 ${descriptor.id} 的字节与 MIME 类型不一致。`);
}
function assertLocalSvg(asset) {
  if (asset.mime !== "image/svg+xml") return;
  const source = new TextDecoder().decode(asset.bytes);
  if (
    /<!DOCTYPE|<!ENTITY|<\s*script\b|<\s*foreignObject\b|<\?xml-stylesheet\b|@import\b/iu.test(
      source,
    )
  )
    throw Error("SVG 图片包含活动内容或外部声明，请使用本地 PNG。 ");
  const allowed = (value) => /^#|^data:image\/(?:png|jpeg|gif|webp);base64,/iu.test(value.trim());
  for (const match of source.matchAll(/(?:\b(?:xlink:)?href|\bsrc)\s*=\s*["']([^"']*)["']/giu))
    if (!allowed(match[1])) throw Error("SVG 图片引用了外部资源，请使用完整的本地图片。 ");
  for (const match of source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/giu))
    if (!allowed(match[1])) throw Error("SVG 图片引用了外部资源，请使用完整的本地图片。 ");
}

/** Read-only validation. No workspace, Figma, filesystem or network APIs are used. */
export async function preparePluginFile(
  text,
  { sha256Bytes = sha256PluginBytes, check = () => {} } = {},
) {
  if (typeof text !== "string" || !text.trim()) throw Error("请选择或粘贴完整 JSON 文件。 ");
  if (length(text) > MAX_PLUGIN_INPUT_BYTES) throw Error("完整设计文件超过 128 MiB。 ");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw Error("JSON 无法解析，请提供完整的设计文件或 Figma 传输包。 ");
  }
  check();
  if (object(value) && value.format === "codeshell.figma.transfer" && value.version === 1) {
    if (length(text) > MAX_FIGMA_JSON_BYTES)
      throw Error("Figma 传输包超过 16 MiB；请分页面导出。 ");
    return { transfer: value, kind: "transfer", warnings: [], summary: null };
  }
  let document,
    resources = new Map(),
    attachments = [],
    kind;
  if (object(value) && value.format === "codeshell.design" && value.version === 3) {
    document = normalizeDesignDocument(value);
    kind = "document";
    if (document.resources.length)
      throw Error(
        "普通 v3 文件只有资源引用，不能独立还原图片或字体；请在设计面板下载「完整备份（完整设计文件）」。 ",
      );
  } else if (
    object(value) &&
    value.format === "codeshell.design.portable-backup" &&
    [1, 2].includes(value.version)
  ) {
    const scopedHash = async (bytes) => {
      check();
      const result = await sha256Bytes(bytes);
      check();
      return result;
    };
    await planPortableDesign(text, {
      sha256: (content) => scopedHash(encoder.encode(content)),
      sha256Bytes: scopedHash,
    });
    check();
    document = normalizeDesignDocument(value.document);
    kind = "portable";
    attachments = value.attachments ?? [];
    const payloads = new Map(value.resources.map((entry) => [entry.id, entry.base64]));
    // Verify MIME bytes for every resource, including unused bytes in the file.
    for (const descriptor of document.resources) {
      check();
      const base64 = payloads.get(descriptor.id);
      if (descriptor.kind === "font") assertFontMime(descriptor, base64);
      else {
        const asset = normalizeFigmaAsset({ mime: descriptor.mime, base64 });
        assertLocalSvg(asset);
        resources.set(descriptor.id, asset);
      }
    }
  } else if (
    object(value) &&
    ["codeshell.design.index", "codeshell.design.bundle"].includes(value.format)
  )
    throw Error("这是项目中的分片索引，缺少独立资源；请下载「完整备份（完整设计文件）」。 ");
  else throw Error("请选择 CodeShell Design v3、完整设计备份或 Figma 传输包。 ");
  check();
  const transfer = createFigmaTransfer(document, { resources });
  if (transfer.stats.skippedNodes)
    throw Error("设计包含尚不能创建的组件实例；请先展开实例再导入，避免遗漏图层。 ");
  const warnings = [...transfer.warnings.map((warning) => warning.message ?? String(warning))];
  const fontCount = document.resources.filter((entry) => entry.kind === "font").length;
  if (fontCount)
    warnings.push(
      `已验证 ${fontCount} 个内嵌字体文件。Figma 插件不能安装字体，文字使用 Figma 可用的同名字体；缺失的图标或私用区字体会阻止导入，普通文字回退会明确报告。`,
    );
  if (attachments.length)
    warnings.push(
      "完整文件的评论、原型和来源附件已校验；本次仅还原可编辑设计图层，不导入 Figma 云评论、交互原型或原文件修改绑定。",
    );
  check();
  return {
    transfer,
    kind,
    warnings,
    summary: {
      pages: transfer.pages.length,
      nodes: transfer.stats.exportedNodes,
      images: resources.size,
      fonts: fontCount,
      attachments: attachments.length,
    },
  };
}
