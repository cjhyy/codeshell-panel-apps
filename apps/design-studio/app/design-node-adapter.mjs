import {
  planHtmlFloatColumns,
  sizeHtmlFloatColumn,
  validateHtmlFloatColumns,
  removeHtmlFloatColumns,
} from "./html-float-columns.mjs";
import { recoverHtmlTextOverflow } from "./html-text-overflow.mjs";
import { cssCornerRadii } from "./corner-radii.mjs";
/* Pure html2figma DesignNode → CodeShell v3 adapter. No DOM, network, or writes. */
import { normalizeDesignDocument, MAX_DESIGN_NODES_PER_PAGE } from "./document.mjs";
import { createDesignResourcePersistencePlan, MAX_DESIGN_RESOURCES } from "./resource-store.mjs";
import { normalizeFigmaAsset } from "./figma-assets.mjs";
import { planHtmlBlockFlow, htmlBlockHorizontalBleed } from "./html-block-flow.mjs";
import { applyHtmlBlockInsets } from "./html-block-insets.mjs";
import { planHtmlViewportFlow } from "./html-viewport-flow.mjs";
import { cssLinearBackgroundPaints } from "./css-linear-gradient.mjs";
import { representativeDesignFill } from "./paint.mjs";
import { normalizeStrokeSides, validateDesignStroke } from "./stroke.mjs";
import { planHtmlGrid, sizeHtmlGridChild, validateHtmlGrid, removeHtmlGrid } from "./html-grid.mjs";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const round = (value) => Math.round(value * 100) / 100 || 0;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const clean = (value, length = 120) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .slice(0, length);
const familyName = (value) =>
  clean(
    String(value ?? "sans-serif")
      .split(",")[0]
      .trim()
      .replace(/^['"]|['"]$/gu, ""),
  ) || "sans-serif";
const weightValue = (value) =>
  value === "bold"
    ? 700
    : value === "normal"
      ? 400
      : clamp(Math.round(finite(Number(value), 400) / 100) * 100, 100, 900);
const bytesToBase64 = (bytes) => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192)
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return globalThis.btoa(binary);
};
const textBytes = (value) => new TextEncoder().encode(value);
const semanticSuffix = (value) => {
  if (typeof value !== "string" || !value) return "";
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1)
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return `-${(hash >>> 0).toString(36)}`;
};
const cssLayoutValue = (source, property) =>
  String(
    source.cssLayout?.[property] ??
      (source.nodeType !== "text" ? source.rawStyles?.[property] : undefined) ??
      "",
  )
    .trim()
    .toLowerCase();
const mainAutoMarginBefore = (source, parent) =>
  !parent.layoutReverse &&
  ["horizontal", "vertical"].includes(parent.layout) &&
  cssLayoutValue(source, parent.layout === "horizontal" ? "margin-left" : "margin-top") === "auto";
const svgElements = new Set(
  "svg g path rect circle ellipse line polyline polygon defs clipPath mask linearGradient radialGradient stop pattern text tspan title desc metadata filter feGaussianBlur feOffset feBlend feColorMatrix feComposite feFlood feMerge feMergeNode feMorphology feTurbulence feDisplacementMap use symbol"
    .toLowerCase()
    .split(" "),
);

/** Accept inert self-contained SVG only; unsupported active/external content is rejected. */
export function inertDesignSvg(value) {
  if (typeof value !== "string" || textBytes(value).length > 1024 * 1024)
    throw new Error("SVG 必须是最多 1 MiB 的文本");
  const source = value
    .replace(/^\uFEFF/u, "")
    .replace(/^\s*<\?xml[^?]*\?>/u, "")
    .trim();
  if (!/^<svg[\s>]/iu.test(source) || /<!|<\?|&(?!(?:amp|lt|gt|quot|apos);)/iu.test(source))
    throw new Error("SVG 包含声明、实体或不支持的标记");
  for (const tag of source.matchAll(/<\/?\s*([\w:-]+)\b([^<>]*)>/gu)) {
    if (!svgElements.has(tag[1].toLowerCase())) throw new Error(`SVG 不允许 ${tag[1]} 元素`);
    if (/\bon[\w:-]+\s*=|\b(?:src|xml:base)\s*=/iu.test(tag[2]))
      throw new Error("SVG 不允许事件或外部资源属性");
    for (const href of tag[2].matchAll(
      /\b(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/giu,
    )) {
      if (!/^#[a-z0-9_.:-]+$/iu.test(href[1] ?? href[2] ?? href[3]))
        throw new Error("SVG 引用必须是内部 ID");
    }
  }
  if (
    /<(?:script|style|foreignObject)\b|\\|@import|(?:javascript|vbscript|data|file)\s*:|url\(\s*(?!['"]?#[a-z0-9_.:-]+['"]?\s*\))/iu.test(
      source,
    )
  )
    throw new Error("SVG 不允许脚本、样式表或外部 URL");
  return source;
}

/**
 * The upstream final renderToDesignDSL pass returns parent-relative bounds.
 * V3 stores page coordinates, with rotations around the node's center.
 * Resource plans are inert write plans, identical to resource-store's contract.
 */
export async function designNodeToV3(tree, options = {}) {
  if (!object(tree)) throw new Error("html2figma DesignNode 根节点必须是对象");
  const coordinateSpace = options.coordinateSpace ?? "parent-relative";
  if (!["parent-relative", "root-relative"].includes(coordinateSpace))
    throw new Error("不支持的 DesignNode 坐标约定");
  const warnings = [],
    mapping = [],
    resourcePlans = [],
    resourcePayloads = new Map();
  const seen = new Set(),
    assets = new Map(),
    fonts = [];
  const autoMarginOverrides = new WeakMap();
  const gridPlans = new WeakMap();
  const blockFlowPlans = new WeakMap();
  const floatPlans = new WeakMap();
  const provenFloatSources = new WeakSet();
  const blockInsetCandidates = [];
  const blockUnwrappedPaths = new WeakMap();
  const localResources =
    options.resources instanceof Map
      ? options.resources
      : new Map(Object.entries(options.resources ?? {}));
  if (localResources.size > MAX_DESIGN_RESOURCES) throw new Error("HTML 本地资源表超过 v3 上限");
  let warningCount = 0,
    sourceNodes = 0,
    importedNodes = 0,
    totalImageBytes = 0;
  const sourceReferences = new WeakSet();
  const validateSourceGraph = (source, depth) => {
    if (!object(source) || sourceReferences.has(source) || depth > 32)
      throw new Error("DesignNode 包含无效、循环、重复引用或超过 32 层的结构");
    sourceReferences.add(source);
    if (++sourceNodes > MAX_DESIGN_NODES_PER_PAGE)
      throw new Error("DesignNode 超过 10,000 个源节点");
    if (source.children !== undefined && !Array.isArray(source.children))
      throw new Error("DesignNode children 必须是数组");
    for (const child of source.children ?? []) validateSourceGraph(child, depth + 1);
  };
  validateSourceGraph(tree, 1);
  const warn = (code, nodeId, message) => {
    warningCount += 1;
    if (warnings.length < 500) warnings.push({ code, nodeId, message });
  };
  const number = (value, fallback, low, high, id, property) => {
    const result = round(clamp(finite(value, fallback), low, high));
    if (!Number.isFinite(value) || value < low || value > high)
      warn("bounded-number", id, `${property} 超出 v3 范围或缺失，已使用 ${result}。`);
    return result;
  };
  const color = (value, id, context = "填充", preserveAlpha = false) => {
    if (!object(value)) return "transparent";
    if (finite(value.a, 1) <= 0) return "transparent";
    if (finite(value.a, 1) < 1 && !preserveAlpha)
      warn(
        "paint-alpha",
        id,
        `${context}的独立透明度不受 v3 支持，已保留 RGB；图层透明度独立保留。`,
      );
    return `#${[value.r, value.g, value.b]
      .map((v) =>
        Math.round(clamp(finite(v), 0, 255))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  };
  const solidFill = (value, node, context = "填充") => {
    node.fill = color(value, node.id, context, true);
    delete node.fillPaints;
    const opacity = clamp(finite(value?.a, 1), 0, 1);
    if (node.fill !== "transparent" && opacity < 1)
      node.fillPaints = [{ type: "SOLID", color: node.fill, opacity }];
  };
  const sha256Bytes =
    options.sha256Bytes ??
    (async (bytes) => {
      if (!globalThis.crypto?.subtle) throw new Error("导入本地资源需要 SHA-256 能力");
      return [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
    });
  const addResource = async (value, nodeId, kind = "image", metadata = {}) => {
    let asset;
    if (kind === "image") {
      asset = normalizeFigmaAsset(value);
      if (asset.mime === "image/svg+xml") {
        const svg = inertDesignSvg(new TextDecoder("utf-8", { fatal: true }).decode(asset.bytes));
        asset = normalizeFigmaAsset({
          mime: "image/svg+xml",
          base64: bytesToBase64(textBytes(svg)),
        });
      }
    } else {
      if (
        !object(value) ||
        typeof value.base64 !== "string" ||
        value.base64.length > Math.ceil((8 * 1024 * 1024) / 3) * 4
      )
        throw new Error("字体需要最多 8 MiB 的本地 Base64");
      asset = value;
    }
    const plan = await createDesignResourcePersistencePlan({
      id: "html-pending",
      kind,
      mime: asset.mime,
      base64: asset.base64,
      sha256Bytes,
      ...metadata,
    });
    const key = `${kind}:${plan.descriptor.sha256}:${asset.mime}:${JSON.stringify(metadata)}`;
    if (assets.has(key)) return assets.get(key);
    if (resourcePlans.length >= MAX_DESIGN_RESOURCES) throw new Error("HTML 资源数量超出 v3 上限");
    if (kind === "image") {
      totalImageBytes += plan.descriptor.bytes;
      if (totalImageBytes > 12 * 1024 * 1024)
        throw new Error("HTML 图片合计超过 12 MiB；请拆分导入");
    }
    let id = `html-${kind === "image" ? "img" : "font"}-${plan.descriptor.sha256.slice(0, 48)}`;
    let suffix = 1;
    while (resourcePayloads.has(id))
      id = `html-${kind === "image" ? "img" : "font"}-${plan.descriptor.sha256.slice(0, 44)}-${suffix++}`;
    plan.descriptor.id = id;
    resourcePlans.push(plan);
    const binary = globalThis.atob(asset.base64),
      bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    resourcePayloads.set(id, {
      descriptor: plan.descriptor,
      mime: asset.mime,
      base64: asset.base64,
      bytes,
      dataUrl: `data:${asset.mime};base64,${asset.base64}`,
    });
    assets.set(key, id);
    return id;
  };
  if (options.fonts !== undefined && (!Array.isArray(options.fonts) || options.fonts.length > 128))
    throw new Error("HTML fonts 必须是最多 128 项的数组");
  for (const font of options.fonts ?? []) {
    const metadata = {
      family: familyName(font.family),
      weight: weightValue(font.weight),
      style: font.style ?? "normal",
    };
    const id = await addResource(font, "html-font", "font", metadata);
    fonts.push({ ...metadata, id });
  }
  const localImage = async (data, id) => {
    // The runtime may canvas-reencode base64; sanitized src retains original local bytes.
    let asset =
      typeof data?.src === "string" && /^data:image\//iu.test(data.src)
        ? data.src
        : (data?.base64 ?? localResources.get(data?.src));
    if (!asset) {
      warn(
        "missing-image-bytes",
        id,
        "图片缺少本地字节，已保留可编辑占位矩形；远程 URL 不会在适配器中访问。",
      );
      return null;
    }
    try {
      if (typeof asset === "string" && !asset.startsWith("data:")) {
        const signature = globalThis.atob(asset.slice(0, 44));
        const mime =
          data?.mime ??
          (signature.startsWith("\x89PNG")
            ? "image/png"
            : signature.startsWith("\xff\xd8\xff")
              ? "image/jpeg"
              : signature.startsWith("GIF8")
                ? "image/gif"
                : signature.startsWith("RIFF") && signature.slice(8, 12) === "WEBP"
                  ? "image/webp"
                  : signature.trimStart().startsWith("<svg")
                    ? "image/svg+xml"
                    : null);
        asset = { mime, base64: asset };
      }
      return await addResource(asset, id);
    } catch (error) {
      warn("invalid-image", id, `图片未导入：${error.message}`);
      return null;
    }
  };
  const notes = (source, id) => {
    const value = { format: "codeshell.html.semantic", version: 1, tag: clean(source.tag, 80) };
    if (source.role) value.role = clean(source.role, 80);
    for (const key of [
      "semanticId",
      "cssSelector",
      "classList",
      "attributes",
      "component",
      "sourceLocation",
    ]) {
      if (source.semantic?.[key] !== undefined) value[key] = source.semantic[key];
    }
    if (source.styledSegments?.length) value.styledSegments = source.styledSegments;
    let serialized;
    try {
      serialized = JSON.stringify(value);
    } catch {
      throw new Error(`HTML 语义 ${id} 含不可序列化数据`);
    }
    if (serialized.length > 2000) {
      warn(
        "semantic-notes-limit",
        id,
        "HTML 语义或富文本元数据超过 2000 字符，备注只保留标签与有界来源标识。",
      );
      return JSON.stringify({
        format: value.format,
        version: 1,
        tag: value.tag,
        ...(value.semanticId ? { semanticId: clean(value.semanticId, 300) } : {}),
        ...(value.cssSelector ? { cssSelector: clean(value.cssSelector, 500) } : {}),
      });
    }
    return serialized;
  };
  const nodeSurface = (id, type, name, geometry) => ({
    id,
    type,
    name: clean(name),
    ...geometry,
    fill: "transparent",
    stroke: "transparent",
    strokeWidth: 0,
    cornerRadius: 0,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  });
  const base = (id, type, name, geometry) => {
    if (++importedNodes > MAX_DESIGN_NODES_PER_PAGE)
      throw new Error("HTML 转换后的图层超过 10,000 个");
    return nodeSurface(id, type, name, geometry);
  };
  const styleSurface = (source, node) => {
    const layers = source.background?.layers ?? [];
    const solid = layers.find((layer) => layer.type === "color" && finite(layer.color?.a, 1) > 0);
    if (solid) solidFill(solid.color, node);
    const gradients = layers.filter((layer) => layer.type.endsWith("gradient"));
    const hasGradient = gradients.length || source.cssBackground?.["background-image"]?.includes("gradient(");
    if (hasGradient) {
      try {
        node.fillPaints = cssLinearBackgroundPaints(source.cssBackground, node.width, node.height);
        node.fill = representativeDesignFill(node.fillPaints);
      } catch (error) {
        warn("unsupported-css-gradient", node.id, `渐变未导入，保留独立背景色：${error.message}。`);
      }
    }
    if (layers.length > 1 && !hasGradient)
      warn(
        "multiple-backgrounds",
        node.id,
        "多重背景仅保留纯色和有本地字节的图片层，混合与叠加语义可能不同。",
      );
    if (source.backgroundClip && source.backgroundClip !== "border-box")
      warn("background-clip", node.id, "背景裁剪区域已近似为容器边界。");
    if (source.borderGradientLayers?.length)
      warn("gradient-border", node.id, "渐变边框未转换为原生描边。");
    const sides = ["top", "right", "bottom", "left"].map((key) => source.border?.[key]);
    const visibleSides = sides.filter(
      (side) => side && side.style !== "none" && side.width > 0 && finite(side.color?.a, 1) > 0,
    );
    if (visibleSides.length) {
      node.stroke = color(visibleSides[0].color, node.id, "描边");
      node.strokeWidth = number(visibleSides[0].width, 0, 0, 100, node.id, "strokeWidth");
    }
    try {
      // Validate raw units before using the converter's transform-scaled px values.
      if (source.cssBorderRadii) cssCornerRadii(source.cssBorderRadii);
      const radii = ["topLeft", "topRight", "bottomRight", "bottomLeft"].map((key) =>
        number(source.border?.radius?.[key] ?? 0, 0, 0, 9999, node.id, `cornerRadii.${key}`),
      );
      if (radii.some((radius) => radius > 0) && source.transform?.scale &&
          Math.abs(Math.abs(source.transform.scale.x) - Math.abs(source.transform.scale.y)) > 1e-6)
        throw new Error("非等比 CSS 缩放产生椭圆圆角，暂不能保留");
      node.cornerRadius = radii[0];
      if (radii.some((value) => value !== radii[0])) node.cornerRadii = radii;
    } catch (error) {
      node.cornerRadius = 0;
      delete node.cornerRadii;
      warn("unsupported-corner-radii", node.id, `${error.message}；未近似圆角。`);
    }
    const borderImage=source.cssLayout?.["border-image-source"];
    if ((borderImage && borderImage!=="none") || sides.some(side=>side?.width>0 && side.style!=="none")) {
      try {
        if(borderImage && borderImage!=="none")throw new Error("border-image 暂不能保留为可编辑实线侧边");
        if (sides.some(side=>side?.width>0 && !["none","solid"].includes(side.style))) throw new Error("虚线、点线或双线暂不能保留");
        node.strokeSides=normalizeStrokeSides(sides.map(side=>({
          width:side?.style === "none" ? 0 : side?.width??0,
          color:color({r:0,g:0,b:0,...side?.color,a:1},node.id,"边框"),
          opacity:side?.color?.a??1,
        })));
        node.strokeAlign="inside";
        validateDesignStroke(node);
        if(visibleSides.length)node.strokeWidth=Math.max(...node.strokeSides.map(s=>s.width));
        if (source.cssLayout?.["border-collapse"] === "collapse" && /^table/u.test(source.cssLayout?.display??"")) {
          node.strokeAlign="center";
          warn("collapsed-border",node.id,"折叠表格边框的共享边缘/半像素归属暂不能保留；侧边按测量边界居中绘制，未声明为完整表格边框语义。");
        }
      } catch (error) {
        delete node.strokeSides;delete node.strokeAlign;
        warn("unsupported-css-border",node.id,`${error.message}；保留测量几何并按统一居中描边近似，原始侧边未声明为无损。`);
      }
    }
    const shadows = source.effects?.boxShadows ?? [];
    const shadow = shadows.find((entry) => !entry.inset);
    if (shadow)
      node.shadow = {
        color: color({ ...shadow.color, a: 1 }, node.id),
        opacity: number(shadow.color?.a ?? 1, 1, 0, 1, node.id, "shadow.opacity"),
        x: number(shadow.offsetX, 0, -500, 500, node.id, "shadow.x"),
        y: number(shadow.offsetY, 0, -500, 500, node.id, "shadow.y"),
        blur: number(shadow.blurRadius, 0, 0, 200, node.id, "shadow.blur"),
      };
    if (shadows.length > 1 || shadows.some((entry) => entry.inset || entry.spreadRadius))
      warn(
        "shadow-approximation",
        node.id,
        "只保留第一项外投影；内阴影、扩散与多重阴影不受 v3 支持。",
      );
    if (
      source.effects?.filters?.length ||
      source.effects?.backdropFilters?.length ||
      (source.effects?.blendMode && source.effects.blendMode !== "normal")
    )
      warn("unsupported-effects", node.id, "滤镜、背景滤镜与混合模式无法完整保留。");
  };
  const alignment = (value, values, fallback, id) => {
    const mapped =
      { "flex-start": "start", "flex-end": "end", left: "start", right: "end", normal: "stretch" }[
        value
      ] ?? value;
    if (mapped && !values.includes(mapped))
      warn("layout-alignment", id, `${value} 对齐不受 v3 支持，已使用 ${fallback}。`);
    return values.includes(mapped) ? mapped : fallback;
  };
  const layout = (source, node) => {
    Object.assign(node, {
      layout: "none",
      gap: 0,
      padding: 0,
      alignItems: "start",
      justifyContent: "start",
      children: [],
    });
    const sourceLayout = source.layout ?? {};
    for (const side of ["Top", "Right", "Bottom", "Left"])
      node[`padding${side}`] = number(
        finite(sourceLayout.padding?.[side.toLowerCase()]) +
          finite(source.border?.[side.toLowerCase()]?.width),
        0,
        0,
        2000,
        node.id,
        `padding${side}`,
      );
    if (["flex", "inline-flex"].includes(sourceLayout.display) && sourceLayout.flex) {
      const flex = sourceLayout.flex;
      node.layout = flex.direction?.startsWith("column") ? "vertical" : "horizontal";
      node.layoutReverse = flex.direction?.endsWith("reverse") ?? false;
      node.layoutWrap =
        { nowrap: "none", wrap: "wrap", "wrap-reverse": "wrap-reverse" }[flex.wrap] ?? "none";
      node.rowGap = number(flex.gap?.row ?? 0, 0, 0, 2000, node.id, "rowGap");
      node.columnGap = number(flex.gap?.column ?? 0, 0, 0, 2000, node.id, "columnGap");
      node.gap = node.layout === "horizontal" ? node.columnGap : node.rowGap;
      node.alignItems = alignment(
        flex.alignItems,
        ["start", "center", "end", "stretch", "baseline"],
        "start",
        node.id,
      );
      node.justifyContent = alignment(
        flex.justifyContent,
        ["start", "center", "end", "space-between"],
        "start",
        node.id,
      );
      node.alignContent = alignment(
        flex.alignContent,
        ["start", "center", "end", "space-between", "stretch"],
        "start",
        node.id,
      );
    } else if (["grid", "inline-grid"].includes(sourceLayout.display) && sourceLayout.grid) {
      try {
        const plan = planHtmlGrid(source);
        Object.assign(node, plan.fields);
        gridPlans.set(node, plan);
        for (const message of plan.warnings) warn("grid-implicit-row-count", node.id, message);
        node.columnGap = number(
          sourceLayout.grid.gap?.column ?? 0,
          0,
          0,
          2000,
          node.id,
          "columnGap",
        );
        node.rowGap = number(sourceLayout.grid.gap?.row ?? 0, 0, 0, 2000, node.id, "rowGap");
        node.gap = node.columnGap;
      } catch (error) {
        warn("grid-fixed-geometry", node.id, `${error.message}；已保留原始 Grid 测量几何。`);
      }
    }
    const floats = planHtmlFloatColumns(source, coordinateSpace);
    if (floats?.unsupported)
      warn("float-flow-fixed", node.id, `${floats.unsupported}；保留测量布局。`);
    else if (floats) {
      Object.assign(node, floats.fields);
      floatPlans.set(node, floats);
      for (const item of floats.items) provenFloatSources.add(item.source);
    }
    const block = floats
      ? null
      : planHtmlBlockFlow(
          source,
          coordinateSpace,
          { x: node.x, y: node.y },
          { ignoreOuterFloat: provenFloatSources.has(source) },
        );
    if (block?.unsupported)
      warn("block-flow-fixed", node.id, block.unsupported);
    else if (block) {
      blockFlowPlans.set(source, block);
      Object.assign(node, {
        layout: "vertical", layoutWrap: "none", gap: 0, rowGap: 0, columnGap: 0,
        alignItems: "start", justifyContent: "start",
        paddingTop: block.paddingTop, paddingBottom: block.paddingBottom,
        paddingLeft: block.paddingLeft, paddingRight: block.paddingRight,
      });
      for (const item of block.items)
        if (item.crossAlign) autoMarginOverrides.set(item.source, {
          handled: new Set(["left", "right"]), singleMain: false, crossAlign: item.crossAlign,
        });
    }
    const flowChildren = (source.children ?? []).filter(
      (child) =>
        child.visible !== false &&
        child.layout?.display !== "none" &&
        !["absolute", "fixed"].includes(child.positioning?.mode),
    );
    if (
      !block && ["horizontal", "vertical"].includes(node.layout) &&
      (source.semantic || source.name !== "margin-wrapper")
    ) {
      const horizontal = node.layout === "horizontal";
      const mainSides = horizontal ? ["left", "right"] : ["top", "bottom"];
      const crossSides = horizontal ? ["top", "bottom"] : ["left", "right"];
      for (const child of flowChildren) {
        const handled = new Set();
        const isAuto = (side) => cssLayoutValue(child, `margin-${side}`) === "auto";
        const zeroOrAuto = (side) =>
          isAuto(side) || finite((child.margin ?? child.layout?.margin)?.[side]) === 0;
        const [before, after] = mainSides.map(isAuto);
        const reversedOverflow =
          node.layoutReverse &&
          finite(child.bounds?.[horizontal ? "width" : "height"]) >
            node[horizontal ? "width" : "height"] -
              node[horizontal ? "paddingLeft" : "paddingTop"] -
              node[horizontal ? "paddingRight" : "paddingBottom"];
        // One item's main-axis auto margins are exactly the parent's alignment.
        // Do not replace distributed margins in a multi-item or wrapping line.
        const singleMain =
          flowChildren.length === 1 &&
          node.layoutWrap === "none" &&
          !reversedOverflow &&
          (before || after) &&
          mainSides.every(zeroOrAuto);
        if (singleMain) {
          node.justifyContent = before && after ? "center" : before ? "end" : "start";
          if (node.layoutReverse && node.justifyContent !== "center")
            node.justifyContent = node.justifyContent === "start" ? "end" : "start";
          for (const side of mainSides) if (isAuto(side)) handled.add(side);
        }
        const [crossBefore, crossAfter] = crossSides.map(isAuto);
        const crossAuto =
          (crossBefore || crossAfter) && crossSides.every(zeroOrAuto) && node.layoutWrap === "none";
        if (crossAuto) for (const side of crossSides) if (isAuto(side)) handled.add(side);
        if (handled.size)
          autoMarginOverrides.set(child, {
            handled,
            singleMain,
            ...(crossAuto
              ? { crossAlign: crossBefore && crossAfter ? "center" : crossBefore ? "end" : "start" }
              : {}),
          });
      }
    }
    const margins = flowChildren.some((child) =>
      ["top", "right", "bottom", "left"].some((side) => {
        if (autoMarginOverrides.get(child)?.handled.has(side)) return false;
        const value = cssLayoutValue(child, `margin-${side}`);
        if (
          value === "auto" &&
          mainAutoMarginBefore(child, node) &&
          side === (node.layout === "horizontal" ? "left" : "top")
        )
          return false;
        return value === "auto" || finite((child.margin ?? child.layout?.margin)?.[side]) !== 0;
      }),
    );
    // The pinned inline-group has already consumed inline margins into its
    // measured bounds and margin wrappers; it is not an authored CSS flex box.
    if (node.layout !== "none" && margins && !block &&
        !(!source.semantic && source.name === "inline-group")) {
      const sides = ["top", "right", "bottom", "left"];
      const spacing = flowChildren.map((child) =>
        sides.map((side) =>
          autoMarginOverrides.get(child)?.handled.has(side)
            ? 0
            : finite((child.margin ?? child.layout?.margin)?.[side]),
        ),
      );
      const uniform =
        ["horizontal", "vertical"].includes(node.layout) &&
        spacing.length > 0 &&
        spacing.every((values, index) =>
          values.every(
            (value, side) =>
              value >= 0 &&
              Math.abs(value - spacing[0][side]) < 0.01 &&
              (autoMarginOverrides.get(flowChildren[index])?.handled.has(sides[side]) ||
                cssLayoutValue(flowChildren[index], `margin-${sides[side]}`) !== "auto"),
          ),
        ) &&
        // A percentage box plus margins can intentionally overflow its parent;
        // FILL would instead consume the newly inset content box.
        flowChildren.every((child) =>
          ["width", "height"].every((axis) => !cssLayoutValue(child, axis).includes("%")),
        );
      const [top, right, bottom, left] = spacing[0] ?? [];
      const rowGap = (node.rowGap ?? node.gap) + top + bottom;
      const columnGap = (node.columnGap ?? node.gap) + left + right;
      const representable =
        uniform &&
        rowGap <= 2000 &&
        columnGap <= 2000 &&
        ["Top", "Right", "Bottom", "Left"].every(
          (side, index) => node[`padding${side}`] + spacing[0][index] <= 2000,
        );
      if (representable) {
        // Flex margins do not collapse. Equal per-child margins are exactly an
        // outer inset plus extra spacing between adjacent items/lines.
        for (const [index, side] of ["Top", "Right", "Bottom", "Left"].entries())
          node[`padding${side}`] += spacing[0][index];
        node.rowGap = rowGap;
        node.columnGap = columnGap;
        node.gap = node.layout === "horizontal" ? columnGap : rowGap;
      } else {
        node.layout = "none";
        warn(
          "layout-margin-fixed",
          node.id,
          "子图层 CSS 外边距不受 v3 完整支持，已保留固定几何避免重新排列失真。",
        );
      }
    }
    for (const key of ["minWidth", "maxWidth", "minHeight", "maxHeight"]) {
      const property = key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
      const declared = cssLayoutValue(source, property);
      if (declared && !/^(?:none|auto|0|\d+(?:\.\d+)?px)$/u.test(declared)) {
        // Upstream parsePx treats 100% as 100. A relative constraint must never
        // silently become a pixel bound on the editable frame.
        warn("css-size-bound-fixed", node.id,
          `${property}: ${declared} 的相对或内在尺寸约束未保留；使用测量尺寸而不应用错误的像素边界。`);
        continue;
      }
      if (sourceLayout.sizing?.[key] !== undefined && sourceLayout.sizing[key] > 0) {
        const sides = key.endsWith("Width") ? ["left", "right"] : ["top", "bottom"];
        const inset = sourceLayout.sizing.boxSizing === "border-box" ? 0 : sides.reduce(
          (sum, side) => sum + finite(sourceLayout.padding?.[side]) + finite(source.border?.[side]?.width), 0);
        node[key] = number(sourceLayout.sizing[key] + inset, 1, 1, 20000, node.id, key);
      }
    }
    for (const axis of ["Width", "Height"])
      if (node[`min${axis}`] > node[`max${axis}`]) {
        delete node[`max${axis}`];
        warn("invalid-sizing", node.id, "CSS 最大尺寸小于最小尺寸，已保留最小尺寸。");
      }
    // A one-line inline button's natural box includes its CSS line box and
    // border, while the upstream text child contains only the glyph bounds.
    if (["flex", "inline-flex"].includes(sourceLayout.display) &&
        cssLayoutValue(source, "height") === "auto" && source.children?.length === 1 &&
        source.children[0].nodeType === "text" && !source.children[0].content?.includes("\n")) {
      const capturedLine = source.children[0].textStyle?.lineHeight;
      const lineHeight = capturedLine?.unit === "px" ? capturedLine.value :
        Number.parseFloat(source.rawStyles?.["line-height"]);
      if (Number.isFinite(lineHeight) && lineHeight > 0) {
        const minimum = lineHeight + node.paddingTop + node.paddingBottom;
        if (minimum <= node.height + 0.05) node.minHeight = Math.max(node.minHeight ?? 1, round(minimum));
      }
    }
    node.clipContent = ["hidden", "scroll", "auto"].includes(source.overflow);
    if (node.clipContent) node.contentClipping = "intentional";
    if (["scroll", "auto"].includes(source.overflow))
      warn("scroll-static", node.id, "滚动容器保留静态裁剪；没有交互滚动行为。");
  };
  const sizing = (source, node, parent) => {
    if (
      node.layoutPositioning !== "absolute" &&
      parent?.layout === "grid" &&
      gridPlans.has(parent)
    ) {
      try {
        sizeHtmlGridChild(source, node, parent, gridPlans.get(parent));
      } catch (error) {
        removeHtmlGrid(parent);
        warn("grid-fixed-geometry", parent.id, `${error.message}；已保留原始 Grid 测量几何。`);
      }
      return;
    }
    if (parent?.layout === "grid" && floatPlans.has(parent)) {
      const plan = floatPlans.get(parent);
      try {
        sizeHtmlFloatColumn(source, node, plan);
      } catch (error) {
        removeHtmlFloatColumns(parent, plan);
        floatPlans.delete(parent);
        warn("float-flow-fixed", parent.id, `${error.message}；保留测量布局。`);
      }
      return;
    }
    const parentAuto =
      node.layoutPositioning !== "absolute" &&
      parent &&
      ["horizontal", "vertical"].includes(parent.layout);
    const marginOverride = parentAuto ? autoMarginOverrides.get(source) : undefined;
    if (marginOverride?.crossAlign) node.layoutAlignSelf = "start";
    const ownAuto = ["horizontal", "vertical", "grid"].includes(node.layout);
    const mainAxis = parent?.layout === "vertical" ? "Vertical" : "Horizontal";
    const crossAxis = mainAxis === "Horizontal" ? "Vertical" : "Horizontal";
    const inheritedAlignment = node.layoutAlignSelf;
    const effectiveAlignment =
      inheritedAlignment && inheritedAlignment !== "auto" ? inheritedAlignment : parent?.alignItems;
    for (const [axis, property] of [
      ["Horizontal", "width"],
      ["Vertical", "height"],
    ]) {
      const value = cssLayoutValue(source, property);
      if (!value) continue;
      if (parentAuto && value.includes("%") && !/^100(?:\.0+)?%$/u.test(value))
        warn("css-percentage-size-fixed", node.id,
          `${property}: ${value} 的百分比尺寸已保留为测量尺寸；父框改变时不会按该比例重新计算。`);
      const intrinsic = ["auto", "min-content", "max-content", "fit-content"].includes(value);
      let mode = "fixed";
      if (parentAuto && /^100(?:\.0+)?%$/u.test(value)) mode = "fill";
      else if (ownAuto && intrinsic) {
        // Block-level auto width fills its containing block; a root's measured
        // width stays fixed until that containing layout is actually represented.
        if (
          (node.layout === "grid" && value === "max-content") ||
          parentAuto ||
          axis === "Vertical" ||
          ["inline-flex", "inline-grid"].includes(source.layout?.display)
        )
          mode = "hug";
      }
      if (parentAuto && axis === crossAxis && value === "auto" && effectiveAlignment === "stretch")
        mode = "fill";
      node[`layoutSizing${axis}`] = mode;
      if (
        parentAuto &&
        axis === crossAxis &&
        value !== "auto" &&
        effectiveAlignment === "stretch"
      ) {
        // CSS stretch ignores a definite cross size. The v3 layout engine uses
        // an explicit child alignment to distinguish that case from stretch.
        node.layoutAlignSelf = "start";
      }
    }
    if (!parentAuto || node.layoutPositioning === "absolute") return;
    if (!marginOverride?.singleMain && mainAutoMarginBefore(source, parent))
      node.layoutMarginBefore = "auto";
    if (source.flexItem?.grow > 0) node[`layoutSizing${mainAxis}`] = "fill";
    else {
      const basis = cssLayoutValue(source, "flex-basis");
      if (
        basis &&
        !["auto", "content", "min-content", "max-content", "fit-content"].includes(basis)
      )
        node[`layoutSizing${mainAxis}`] = "fixed";
    }
  };
  const transformPoint = (point, center, degrees) => {
    const radians = (degrees * Math.PI) / 180,
      x = point.x - center.x,
      y = point.y - center.y;
    return {
      x: center.x + x * Math.cos(radians) - y * Math.sin(radians),
      y: center.y + x * Math.sin(radians) + y * Math.cos(radians),
    };
  };
  const origin = { x: finite(tree.bounds?.x), y: finite(tree.bounds?.y) };
  const wrapCrossAutoMargins = (source, node, parent) => {
    const override = autoMarginOverrides.get(source);
    if (!override?.crossAlign || !["horizontal", "vertical"].includes(parent.layout)) return node;
    const horizontal = parent.layout === "horizontal";
    const cross = horizontal ? "Vertical" : "Horizontal";
    const main = horizontal ? "Horizontal" : "Vertical";
    const paddingStart = horizontal ? parent.paddingTop : parent.paddingLeft;
    const paddingEnd = horizontal ? parent.paddingBottom : parent.paddingRight;
    const crossSize = horizontal ? "Height" : "Width";
    const minimumCross =
      node[`layoutSizing${cross}`] === "fill"
        ? Math.max(1, finite(node[`min${crossSize}`], 1))
        : node[crossSize.toLowerCase()];
    if (node[`layoutSizing${cross}`] === "hug")
      warn(
        "auto-margin-intrinsic-minimum",
        node.id,
        "自动外边距包装框使用导入时的内容最小尺寸；编辑 Hug 内容后需要核对该最小尺寸。",
      );
    const wrapper = base(`${node.id}-auto-margin`, "frame", `${node.name} auto margins`, {
      x: horizontal ? node.x : parent.x + paddingStart,
      y: horizontal ? parent.y + paddingStart : node.y,
      width: horizontal
        ? node.width
        : Math.max(minimumCross, parent.width - paddingStart - paddingEnd),
      height: horizontal
        ? Math.max(minimumCross, parent.height - paddingStart - paddingEnd)
        : node.height,
    });
    Object.assign(wrapper, {
      layout: horizontal ? "vertical" : "horizontal",
      gap: 0,
      padding: 0,
      alignItems: "start",
      justifyContent: override.crossAlign,
      layoutAlignSelf: "stretch",
      [`layoutSizing${cross}`]: "fill",
      [`layoutSizing${main}`]: node[`layoutSizing${main}`] ?? "fixed",
      [horizontal ? "minHeight" : "minWidth"]: minimumCross,
      children: [node],
    });
    for (const prefix of ["min", "max"]) {
      const property = `${prefix}${horizontal ? "Width" : "Height"}`;
      if (node[property] !== undefined) wrapper[property] = node[property];
    }
    if (node.layoutMarginBefore) {
      wrapper.layoutMarginBefore = node.layoutMarginBefore;
      delete node.layoutMarginBefore;
    }
    // Main-axis alignment has nonnegative free space. A perpendicular wrapper
    // preserves CSS auto-margin overflow toward cross-end, whereas align-self
    // center/end would move oversized content before the parent's content box.
    node.layoutAlignSelf = "start";
    return wrapper;
  };
  const wrapBlockFlow = (item, next, original, parent) => {
    let node = original;
    if (item.fill) node.layoutSizingHorizontal = "fill";
    node.layoutAlignSelf = "start";
    delete node.layoutMarginBefore;
    node.layoutSizingVertical = "fixed";
    if (["horizontal", "vertical", "grid"].includes(node.layout) &&
        (cssLayoutValue(item.source, "height") === "auto" || !item.source.semantic))
      node.layoutSizingVertical = "hug";
    const gap = Math.max(0, item.gap);
    let overlap = Math.min(0, next?.gap ?? 0);
    if (overlap && !item.source.semantic && item.source.name === "margin-wrapper" &&
        node.layout === "vertical" && node.paddingBottom >= -overlap) {
      // Upstream rounds collapsed gaps to integer pixels. Restore the exact
      // browser interval in editable padding instead of freezing its height.
      node.paddingBottom = round(node.paddingBottom + overlap);
      node.height = round(node.height + overlap);
      overlap = 0;
    }
    node = wrapCrossAutoMargins(item.source, node, parent);
    if (item.bleed) {
      const magnitude = Math.max(item.bleed.left, item.bleed.right) + 1;
      const width = Math.max(1, parent.width - (parent.paddingLeft ?? parent.padding ?? 0) - (parent.paddingRight ?? parent.padding ?? 0));
      const wrapper = base(`${node.id}-horizontal-bleed`, "frame", `${node.name} horizontal margins`, {
        x: parent.x + (parent.paddingLeft ?? parent.padding ?? 0), y: node.y, width, height: node.height,
      });
      const spacer = (side, size, x) => base(`${node.id}-bleed-${side}`, "rectangle", `Horizontal margin ${side}`, { x, y: node.y, width: size, height: 1 });
      const before = spacer("start", magnitude - item.bleed.left, wrapper.x);
      const after = spacer("end", magnitude - item.bleed.right, node.x + node.width - magnitude);
      Object.assign(wrapper, { layout: "horizontal", layoutWrap: "none", gap: -magnitude, padding: 0,
        alignItems: "start", justifyContent: "start", layoutSizingHorizontal: "fill", layoutSizingVertical: "hug",
        clipContent: false, children: [before, node, after] });
      node.layoutSizingHorizontal = "fill";
      node = wrapper;
    }
    if (!gap && !overlap) return node;
    const wrapper = base(`${node.id}-block-spacing`, "frame", `${node.name} block spacing`, {
      x: node.x, y: node.y - gap, width: node.width,
      height: Math.max(1, node.height + gap + overlap),
    });
    Object.assign(wrapper, {
      layout: "vertical", layoutWrap: "none", gap: 0, padding: 0,
      paddingTop: gap, alignItems: "start", justifyContent: "start",
      layoutSizingHorizontal: node.layoutSizingHorizontal ?? "fixed",
      layoutSizingVertical: overlap ? "fixed" : "hug", children: [node],
    });
    if (overlap) warn("block-flow-overlap", node.id,
      "微小负外边距使用固定流占位高度保留重叠；编辑该项高度后需核对占位高度。");
    return wrapper;
  };
  const convert = async (source, path, parentAnchor, ancestors) => {
    if (!object(source) || seen.has(source) || path.length > 32)
      throw new Error("DesignNode 包含无效、循环、重复引用或超过 32 层的结构");
    seen.add(source);
    const provenFloat = provenFloatSources.has(source);
    if (!["container", "text", "image", "svg"].includes(source.nodeType))
      throw new Error(`不支持的 DesignNode 类型：${source.nodeType}`);
    if (source.children !== undefined && !Array.isArray(source.children))
      throw new Error("DesignNode children 必须是数组");
    if (["flex", "inline-flex", "block", "flow-root"].includes(source.layout?.display) && source.children) {
      // The pinned converter turns resolved auto margins into fixed padding in
      // synthetic wrappers. Recover the original child before interpreting its
      // captured CSS intent; its measured bounds remain parent-relative.
      source = {
        ...source,
        children: source.children.map((wrapper) => {
          if (
            wrapper?.nodeType !== "container" ||
            wrapper.name !== "margin-wrapper" ||
            wrapper.semantic ||
            wrapper.children?.length !== 1
          )
            return wrapper;
          const child = wrapper.children[0];
          const sides = ["top", "right", "bottom", "left"];
          const values = sides.map((side) => cssLayoutValue(child, `margin-${side}`));
          if (
            !htmlBlockHorizontalBleed(child) && (!values.includes("auto") ||
            !values.every((value) => value === "auto" || /^0(?:\.0+)?(?:px)?$/u.test(value)))
          )
            return wrapper;
          const recovered = {
            ...child,
            bounds: {
              ...child.bounds,
              x:
                finite(child.bounds?.x) +
                (coordinateSpace === "parent-relative" ? finite(wrapper.bounds?.x) : 0),
              y:
                finite(child.bounds?.y) +
                (coordinateSpace === "parent-relative" ? finite(wrapper.bounds?.y) : 0),
            },
          };
          // A block recovery keeps the original semantic child's source path,
          // even though its inert margin wrapper no longer needs conversion.
          if (["block", "flow-root"].includes(source.layout.display))
            blockUnwrappedPaths.set(recovered, [0]);
          return recovered;
        }),
      };
    }
    if (provenFloat) provenFloatSources.add(source);
    const id = `html-${path.map((value) => value.toString(36)).join("-")}${semanticSuffix(source.semantic?.semanticId)}`;
    let width = number(source.bounds?.width, 1, 1, 20000, id, "width"),
      height = number(source.bounds?.height, 1, 1, 20000, id, "height");
    const anchor = {
      x:
        number(source.bounds?.x, 0, -20000, 20000, id, "bounds.x") +
        (coordinateSpace === "parent-relative" ? parentAnchor.x : 0),
      y:
        number(source.bounds?.y, 0, -20000, 20000, id, "bounds.y") +
        (coordinateSpace === "parent-relative" ? parentAnchor.y : 0),
    };
    const degrees = finite(source.transform?.rotation),
      radians = (degrees * Math.PI) / 180;
    let center = {
      x: anchor.x + (Math.cos(radians) * width) / 2 - (Math.sin(radians) * height) / 2,
      y: anchor.y + (Math.sin(radians) * width) / 2 + (Math.cos(radians) * height) / 2,
    };
    const ancestorRotation = ancestors.reduce((sum, ancestor) => sum + ancestor.rotation, 0);
    // Children without their own CSS transform retain getBoundingClientRect AABB sizes.
    // Recover unrotated dimensions when the ancestors' rotation is non-degenerate.
    if (ancestorRotation && !source.transform?.matrix && !source.transform?.scale && !degrees) {
      const c = Math.abs(Math.cos((ancestorRotation * Math.PI) / 180));
      const s = Math.abs(Math.sin((ancestorRotation * Math.PI) / 180));
      const determinant = c * c - s * s;
      const inferredWidth = (width * c - height * s) / determinant;
      const inferredHeight = (height * c - width * s) / determinant;
      if (
        Math.abs(determinant) > 0.0001 &&
        inferredWidth >= 1 &&
        inferredHeight >= 1 &&
        inferredWidth <= 20000 &&
        inferredHeight <= 20000
      ) {
        width = round(inferredWidth);
        height = round(inferredHeight);
      }
    }
    center.x -= origin.x;
    center.y -= origin.y;
    for (const ancestor of ancestors)
      if (ancestor.rotation)
        center = transformPoint(
          center,
          { x: ancestor.x + ancestor.width / 2, y: ancestor.y + ancestor.height / 2 },
          -ancestor.rotation,
        );
    const node = base(
      id,
      source.nodeType === "container" ? "frame" : source.nodeType === "text" ? "text" : "rectangle",
      source.name || source.tag || source.nodeType,
      {
        x: number(center.x - width / 2, 0, -20000, 20000, id, "x"),
        y: number(center.y - height / 2, 0, -20000, 20000, id, "y"),
        width,
        height,
      },
    );
    node.rotation = round(((((degrees + 180) % 360) + 360) % 360) - 180);
    node.opacity = number(source.opacity ?? 1, 1, 0, 1, id, "opacity");
    node.visible = source.visible !== false && source.layout?.display !== "none";
    node.notes = notes(source, id);
    mapping.push({
      designId: id,
      path: path.join("."),
      ...(typeof source.id === "string" ? { sourceId: source.id } : {}),
      ...(typeof source.semantic?.semanticId === "string"
        ? { semanticId: source.semantic.semanticId }
        : {}),
    });
    if (
      source.transform?.matrix &&
      Math.abs(
        source.transform.matrix[0] * source.transform.matrix[2] +
          source.transform.matrix[1] * source.transform.matrix[3],
      ) > 0.001
    )
      warn("transform-skew", id, "倾斜矩阵已近似为测量边界和旋转。");
    if (source.transform?.scale && (source.transform.scale.x < 0 || source.transform.scale.y < 0))
      warn("transform-reflection", id, "镜像不能在 v3 保留；仅使用测量尺寸与旋转。");
    if (ancestors.some((entry) => entry.rotation))
      warn(
        "nested-transform-approximation",
        id,
        "祖先旋转已反算中心；上游测量尺寸受嵌套变换影响，需核对视觉结果。",
      );
    styleSurface(source, node);
    if (["absolute", "fixed"].includes(source.positioning?.mode))
      node.layoutPositioning = "absolute";
    if (source.positioning?.mode === "sticky")
      warn("sticky-static", id, "sticky 保留当前测量位置，不包含滚动吸附行为。");
    if (source.nodeType === "text") {
      const style = source.textStyle ?? {},
        content = String(source.content ?? "");
      if (content.length > 4000)
        throw new Error(`文字 ${id} 超过 v3 的 4000 字符上限；请拆分源文本`);
      node.text = content;
      node.textSource = content;
      node.fontSize = number(style.fontSize, 16, 6, 240, id, "fontSize");
      node.fontWeight = weightValue(style.fontWeight);
      if (typeof style.fontWeight === "number" && node.fontWeight !== style.fontWeight)
        warn("font-weight-rounded", id, "可变字重已取最接近的百位字重。");
      node.fontFamily = familyName(style.fontFamily);
      node.fontStyle =
        style.fontStyle === "italic" || style.fontStyle === "oblique" ? "italic" : "normal";
      if (style.fontStyle === "oblique") warn("font-oblique", id, "斜体倾斜已近似为 italic。");
      const lineHeight = style.lineHeight;
      node.lineHeight = number(
        lineHeight?.unit === "px"
          ? lineHeight.value / node.fontSize
          : lineHeight?.unit === "%"
            ? lineHeight.value / 100
            : 1.2,
        1.2,
        0.7,
        3,
        id,
        "lineHeight",
      );
      if (lineHeight?.unit === "normal")
        warn("line-height-normal", id, "normal 行高暂使用 1.2 倍字号，需要视觉核对。");
      node.letterSpacing = number(
        finite(style.letterSpacing?.value) *
          (style.letterSpacing?.unit === "em" ? node.fontSize : 1),
        0,
        -20,
        100,
        id,
        "letterSpacing",
      );
      node.textAlign = ["left", "center", "right"].includes(style.textAlign)
        ? style.textAlign
        : "left";
      node.textDecoration = ["none", "underline", "line-through"].includes(style.textDecoration)
        ? style.textDecoration
        : "none";
      solidFill(style.color, node, "文字填充");
      node.cornerRadius = 0;
      delete node.cornerRadii;
      node.textMeasurement = "browser";
      if (source.background?.layers?.length)
        warn("text-background", id, "文字节点背景无法与文字填充独立保留；应使用外层容器背景。");
      if (String(style.fontFamily).includes(","))
        warn(
          "font-fallback-chain",
          id,
          "v3 只保留 CSS 字体列表中的第一项；字体回退链需要运行环境核对。",
        );
      if (style.textAlign === "justify" || style.textDecoration === "overline")
        warn("text-style-approximation", id, "两端对齐或上划线不能在 v3 完整保留。");
      if (source.styledSegments?.length)
        warn(
          "rich-text-uniform",
          id,
          "混合文字样式在 v3 使用基础样式；有界原分段元数据保存在备注，不能原生编辑各段样式。",
        );
      if (source.listType)
        warn("text-list", id, "原生有序／无序列表类型暂未转换为 v3 行项目符号；保留字符内容。");
      if (style.gradientFill?.length)
        warn("text-gradient", id, "渐变文字使用基础文字颜色，不保留渐变。");
      if (style.textShadow?.length) warn("text-shadow", id, "文字阴影未转换。");
      if (style.textTransform && style.textTransform !== "none")
        warn("text-transform", id, "CSS text-transform 未应用到字符内容。");
      const font = fonts.find(
        (entry) =>
          entry.family.toLowerCase() === node.fontFamily.toLowerCase() &&
          entry.weight === node.fontWeight &&
          (entry.style === node.fontStyle ||
            (entry.style === "oblique" && node.fontStyle === "italic")),
      );
      if (font) node.fontRef = font.id;
    } else if (source.nodeType === "image" || source.nodeType === "svg") {
      let imageRef = null;
      if (source.nodeType === "svg") {
        try {
          imageRef = await addResource(
            {
              mime: "image/svg+xml",
              base64: bytesToBase64(textBytes(inertDesignSvg(source.svgContent))),
            },
            id,
          );
        } catch (error) {
          warn("invalid-svg", id, `SVG 未导入：${error.message}`);
        }
        if (imageRef)
          warn(
            "svg-image-resource",
            id,
            "SVG 原文保存在本地图片资源中，作为可见图片编辑位置和尺寸；不能编辑矢量路径。",
          );
      } else imageRef = await localImage(source.imageData, id);
      if (imageRef) {
        node.type = "image";
        node.imageRef = imageRef;
        const fit = source.imageData?.objectFit ?? "contain";
        node.objectFit = ["fill", "contain", "cover"].includes(fit) ? fit : "contain";
        if (!["fill", "contain", "cover"].includes(fit))
          warn("image-object-fit", id, `${fit} 已近似为 contain。`);
      } else {
        node.fill = "#e2e8f0";
        node.stroke = "#64748b";
        node.strokeWidth = 1;
      }
    } else {
      layout(source, node);
      for (const [index, layer] of (source.background?.layers ?? []).entries()) {
        if (layer.type !== "image") continue;
        const imageRef = await localImage({ src: layer.url, base64: layer.base64 }, id);
        if (!imageRef) continue;
        const background = base(`${id}-bg-${index}`, "image", `${node.name} background`, {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
        });
        Object.assign(background, {
          imageRef,
          objectFit: layer.size === "cover" ? "cover" : "contain",
          layoutPositioning: "absolute",
        });
        node.children.push(background);
        if (
          (layer.repeat && layer.repeat !== "no-repeat") ||
          !["cover", "contain"].includes(layer.size)
        )
          warn(
            "background-image-approximation",
            id,
            "背景平铺、显式尺寸和偏移已近似为覆盖容器的图片。",
          );
      }
      const block = blockFlowPlans.get(source);
      const entries = floatPlans.get(node)?.entries ?? block?.entries ?? (source.children ?? []).map((child, index) => ({ source: child, index }));
      for (const { source: child, index } of entries) {
        const converted = await convert(child, [...path, index, ...(blockUnwrappedPaths.get(child) ?? [])], anchor, [...ancestors, node]);
        if (block?.promoted.has(child)) delete converted.layoutPositioning;
        if (node.layout !== "none") {
          if (child.flexItem?.alignSelf)
            converted.layoutAlignSelf = alignment(
              child.flexItem.alignSelf,
              ["auto", "start", "center", "end", "stretch", "baseline"],
              "auto",
              converted.id,
            );
        }
        sizing(child, converted, node);
        const itemIndex = block?.items.findIndex((item) => item.source === child) ?? -1;
        if (itemIndex >= 0) block.items[itemIndex].original = converted;
        node.children.push(itemIndex >= 0
          ? wrapBlockFlow(block.items[itemIndex], block.items[itemIndex + 1], converted, node)
          : wrapCrossAutoMargins(child, converted, node));
      }
      if (block?.items.some((item) => item.bleed)) blockInsetCandidates.push({ source, node, block,
        ancestorTransformed: ancestors.some((ancestor) => ancestor.rotation) });
    }
    if (source.nodeType === "container") recoverHtmlTextOverflow(source, node, warn);
    return node;
  };
  const converted = await convert(tree, [0], { x: 0, y: 0 }, []);
  sizing(tree, converted, null);
  const validateGrids = (node) => {
    for (const child of node.children ?? []) validateGrids(child);
    if (floatPlans.has(node)) {
      const plan = floatPlans.get(node);
      try {
        validateHtmlFloatColumns(node);
        warn(
          "float-flow-captured-state",
          node.id,
          "浮动列按捕获时的百分比恢复为原生 Grid；不保留媒体查询断点、浮动换行或文字环绕，跨 CSS 状态请重新捕获。",
        );
      } catch (error) {
        removeHtmlFloatColumns(node, plan);
        warn("float-flow-fixed", node.id, `${error.message}；保留测量布局。`);
      }
    }
    if (!gridPlans.has(node)) return;
    try {
      if (node.layout === "grid") validateHtmlGrid(node);
      else removeHtmlGrid(node);
    } catch (error) {
      removeHtmlGrid(node);
      warn("grid-fixed-geometry", node.id, `${error.message}；已保留原始 Grid 测量几何。`);
    }
  };
  validateGrids(converted);
  const bounds = options.captureBounds;
  const viewportWidth = bounds ? bounds.right - bounds.left : options.viewportWidth;
  const viewportHeight = bounds ? bounds.bottom - bounds.top : options.viewportHeight;
  const viewport = options.includeViewport !== false &&
    (viewportWidth !== undefined || viewportHeight !== undefined);
  if (
    viewport &&
    (![viewportWidth, viewportHeight].every(
      (value) => Number.isFinite(value) && value >= 100 && value <= 10000,
    ) ||
      (bounds && ![bounds.left, bounds.top].every(Number.isFinite)))
  )
    throw new Error("HTML 捕获视口宽高必须在 100–10000 范围内");
  let roots = [converted];
  if (viewport) {
    const relation = options.viewportRelation;
    if ((bounds && (bounds.left || bounds.top)) || relation) {
      const offsetX = finite(relation?.x) - finite(bounds?.left);
      const offsetY = finite(relation?.y) - finite(bounds?.top);
      const shift = (node) => {
        node.x = number(node.x + offsetX, 0, -20000, 20000, node.id, "x");
        node.y = number(node.y + offsetY, 0, -20000, 20000, node.id, "y");
        for (const child of node.children ?? []) shift(child);
      };
      shift(converted);
    }
    const wrapper = base("html-viewport", "frame", "HTML viewport", {
      x: 0,
      y: 0,
      width: viewportWidth,
      height: viewportHeight,
    });
    Object.assign(wrapper, {
      layout: "none",
      gap: 0,
      padding: 0,
      alignItems: "start",
      justifyContent: "start",
      clipContent: true,
      contentClipping: "intentional",
      children: roots,
    });
    const flow = planHtmlViewportFlow(tree, converted, relation, viewportWidth, viewportHeight, bounds);
    if (flow?.unsupported) warn("viewport-flow-fixed", converted.id, flow.unsupported);
    else if (flow) {
      Object.assign(wrapper, {
        layout: "vertical", layoutWrap: "none", rowGap: 0, columnGap: 0,
        paddingTop: flow.top, paddingLeft: flow.left, paddingRight: flow.right, paddingBottom: flow.bottom,
      });
      delete converted.layoutPositioning;
      converted.layoutAlignSelf = "start";
      converted.layoutSizingHorizontal = flow.fill ? "fill" : "fixed";
      if (flow.fillHeight) converted.layoutSizingVertical = "fill";
      if (flow.crossAlign) autoMarginOverrides.set(tree, {
        handled: new Set(["left", "right"]), singleMain: false, crossAlign: flow.crossAlign,
      });
      wrapper.children = [wrapCrossAutoMargins(tree, converted, wrapper)];
    }
    roots = [wrapper];
  }
  const rebasedNodeCount = applyHtmlBlockInsets(roots, blockInsetCandidates, nodeSurface, warn, MAX_DESIGN_NODES_PER_PAGE);
  if (rebasedNodeCount !== null) importedNodes = rebasedNodeCount;
  const rootColor = tree.background?.layers?.find((layer) => layer.type === "color")?.color;
  const background =
    options.background ??
    (rootColor && finite(rootColor.a, 1) >= 1 ? color(rootColor, converted.id) : "#ffffff");
  // A captured webpage carries its viewport color when exported on its own.
  // Native frame exports do not include the Figma page's canvas background.
  if (viewport && options.viewportRelation && options.background !== undefined)
    roots[0].fill = background;
  const document = {
    format: "codeshell.design",
    version: 3,
    name: clean(options.name || tree.name || "HTML import") || "HTML import",
    canvas: {
      width: number(
        viewport ? viewportWidth : converted.width,
        1440,
        100,
        10000,
        converted.id,
        "canvas.width",
      ),
      height: number(
        viewport ? viewportHeight : converted.height,
        900,
        100,
        10000,
        converted.id,
        "canvas.height",
      ),
      background,
    },
    tokens: { colors: [] },
    resources: resourcePlans.map((plan) => plan.descriptor),
    activePageId: "page-html",
    pages: [{ id: "page-html", name: clean(options.pageName || "HTML import"), children: roots }],
  };
  normalizeDesignDocument(document);
  return {
    document,
    resourcePlans,
    resourcePayloads,
    mapping,
    report: {
      warnings,
      stats: {
        sourceNodes,
        importedNodes,
        resourceCount: resourcePlans.length,
        warningCount,
        omittedWarnings: Math.max(0, warningCount - warnings.length),
      },
    },
  };
}
