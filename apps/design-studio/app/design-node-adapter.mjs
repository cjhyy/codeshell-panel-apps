/* Pure html2figma DesignNode → CodeShell v3 adapter. No DOM, network, or writes. */
import { normalizeDesignDocument, MAX_DESIGN_NODES_PER_PAGE } from "./document.mjs";
import { createDesignResourcePersistencePlan, MAX_DESIGN_RESOURCES } from "./resource-store.mjs";
import { normalizeFigmaAsset } from "./figma-assets.mjs";

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
  const localResources =
    options.resources instanceof Map
      ? options.resources
      : new Map(Object.entries(options.resources ?? {}));
  if (localResources.size > MAX_DESIGN_RESOURCES) throw new Error("HTML 本地资源表超过 v3 上限");
  let warningCount = 0,
    sourceNodes = 0,
    importedNodes = 0,
    totalImageBytes = 0;
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
  const color = (value, id, context = "填充") => {
    if (!object(value)) return "transparent";
    if (finite(value.a, 1) <= 0) return "transparent";
    if (finite(value.a, 1) < 1)
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
  const base = (id, type, name, geometry) => {
    if (++importedNodes > MAX_DESIGN_NODES_PER_PAGE)
      throw new Error("HTML 转换后的图层超过 10,000 个");
    return {
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
    };
  };
  const styleSurface = (source, node) => {
    const layers = source.background?.layers ?? [];
    const solid = layers.find((layer) => layer.type === "color" && finite(layer.color?.a, 1) > 0);
    if (solid) node.fill = color(solid.color, node.id);
    const gradients = layers.filter((layer) => layer.type.endsWith("gradient"));
    if (gradients.length) {
      if (!solid) node.fill = color(gradients.at(-1).stops?.[0]?.color, node.id);
      warn(
        "gradient-solid-fallback",
        node.id,
        "v3 不支持渐变；已使用纯色近似，渐变方向与色标不能编辑或完整回导。",
      );
    }
    if (layers.length > 1)
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
      if (sides.some((side) => JSON.stringify(side) !== JSON.stringify(sides[0])))
        warn("border-sides", node.id, "不同方向边框已近似为统一描边。");
      if (visibleSides.some((side) => side.style !== "solid"))
        warn("border-style", node.id, "虚线、点线或双线边框已近似为实线。");
    }
    const radii = Object.values(source.border?.radius ?? {});
    node.cornerRadius = number(
      radii.length ? Math.max(...radii) : 0,
      0,
      0,
      9999,
      node.id,
      "cornerRadius",
    );
    if (new Set(radii).size > 1)
      warn("corner-radii", node.id, "各角半径不同，已近似为统一最大圆角。");
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
        sourceLayout.padding?.[side.toLowerCase()] ?? 0,
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
      const grid = sourceLayout.grid;
      const columns = String(grid.templateColumns ?? "")
        .trim()
        .split(/\s+/u);
      const tracks = columns.map((track) =>
        /^\d+(?:\.\d+)?px$/u.test(track) ? Number.parseFloat(track) : NaN,
      );
      const simple =
        tracks.length <= 24 &&
        tracks.every(Number.isFinite) &&
        tracks.every((track) => Math.abs(track - tracks[0]) < 0.5) &&
        !/dense|column/u.test(grid.autoFlow ?? "");
      if (simple) {
        node.layout = "grid";
        node.gridColumns = tracks.length;
        node.columnGap = number(grid.gap?.column ?? 0, 0, 0, 2000, node.id, "columnGap");
        node.rowGap = number(grid.gap?.row ?? 0, 0, 0, 2000, node.id, "rowGap");
        node.gap = node.columnGap;
      } else
        warn(
          "grid-fixed-geometry",
          node.id,
          "不规则 Grid 已保留测量位置；网格轨道、命名区域及自动放置关系未保留。",
        );
    }
    const margins = (source.children ?? []).some((child) =>
      Object.values(child.margin ?? child.layout?.margin ?? {}).some(
        (value) => finite(value) !== 0,
      ),
    );
    if (node.layout !== "none" && margins) {
      node.layout = "none";
      warn(
        "layout-margin-fixed",
        node.id,
        "子图层 CSS 外边距不受 v3 完整支持，已保留固定几何避免重新排列失真。",
      );
    }
    for (const key of ["minWidth", "maxWidth", "minHeight", "maxHeight"])
      if (sourceLayout.sizing?.[key] !== undefined && sourceLayout.sizing[key] > 0)
        node[key] = number(sourceLayout.sizing[key], 1, 1, 20000, node.id, key);
    for (const axis of ["Width", "Height"])
      if (node[`min${axis}`] > node[`max${axis}`]) {
        delete node[`max${axis}`];
        warn("invalid-sizing", node.id, "CSS 最大尺寸小于最小尺寸，已保留最小尺寸。");
      }
    node.clipContent = ["hidden", "scroll", "auto"].includes(source.overflow);
    if (node.clipContent) node.contentClipping = "intentional";
    if (["scroll", "auto"].includes(source.overflow))
      warn("scroll-static", node.id, "滚动容器保留静态裁剪；没有交互滚动行为。");
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
  const convert = async (source, path, parentAnchor, ancestors) => {
    if (!object(source) || seen.has(source) || path.length > 32)
      throw new Error("DesignNode 包含无效、循环、重复引用或超过 32 层的结构");
    seen.add(source);
    if (++sourceNodes > MAX_DESIGN_NODES_PER_PAGE)
      throw new Error("DesignNode 超过 10,000 个源节点");
    if (!["container", "text", "image", "svg"].includes(source.nodeType))
      throw new Error(`不支持的 DesignNode 类型：${source.nodeType}`);
    if (source.children !== undefined && !Array.isArray(source.children))
      throw new Error("DesignNode children 必须是数组");
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
      node.fill = color(style.color, id, "文字填充");
      node.cornerRadius = 0;
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
      for (const [index, child] of (source.children ?? []).entries()) {
        const converted = await convert(child, [...path, index], anchor, [...ancestors, node]);
        if (node.layout !== "none") {
          if (child.flexItem?.grow > 0)
            converted[
              node.layout === "vertical" ? "layoutSizingVertical" : "layoutSizingHorizontal"
            ] = "fill";
          if (child.flexItem?.alignSelf)
            converted.layoutAlignSelf = alignment(
              child.flexItem.alignSelf,
              ["auto", "start", "center", "end", "stretch", "baseline"],
              "auto",
              converted.id,
            );
        }
        node.children.push(converted);
      }
    }
    return node;
  };
  const converted = await convert(tree, [0], { x: 0, y: 0 }, []);
  const bounds = options.captureBounds;
  const viewportWidth = bounds ? bounds.right - bounds.left : options.viewportWidth;
  const viewportHeight = bounds ? bounds.bottom - bounds.top : options.viewportHeight;
  const viewport = viewportWidth !== undefined || viewportHeight !== undefined;
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
    if (bounds && (bounds.left || bounds.top)) {
      const shift = (node) => {
        node.x = number(node.x - bounds.left, 0, -20000, 20000, node.id, "x");
        node.y = number(node.y - bounds.top, 0, -20000, 20000, node.id, "y");
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
    roots = [wrapper];
  }
  const rootColor = tree.background?.layers?.find((layer) => layer.type === "color")?.color;
  const background =
    options.background ??
    (rootColor && finite(rootColor.a, 1) >= 1 ? color(rootColor, converted.id) : "#ffffff");
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
