import { mainAxisGap } from "./layout-spacing.mjs";
import {
  cssGridTrack,
  gridPlacements,
  effectiveGridRows,
  effectiveGridRowTracks,
  gridFillHugContentHeight,
} from "./grid.mjs";
import { designPaintCssImage } from "./paint.mjs";
import { nativeTextContent } from "./text-content.mjs";
import { hasDesignStroke, designStrokeSides, strokeLayoutBasisExtra } from "./stroke.mjs";
/* Deterministic CodeShell Design v3 to editable HTML/CSS export. */
import { designFontFaceCss, designFontFamilyCss } from "./font-css.mjs";

const CONTAINER_TYPES = new Set(["frame", "group", "component"]);
const PAINTLESS_TYPES = new Set(["group", "instance"]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cssNumber(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return `${fallback}px`;
  const rounded = Math.round(number * 1000) / 1000;
  return `${Object.is(rounded, -0) ? 0 : rounded}px`;
}

function cssColor(value, fallback = "transparent") {
  return typeof value === "string" && (value === "transparent" || /^#[\da-f]{6}$/iu.test(value))
    ? value.toLowerCase()
    : fallback;
}

function pageChildren(page) {
  return Array.isArray(page?.children)
    ? page.children
    : Array.isArray(page?.nodes)
      ? page.nodes
      : [];
}

function allNodes(nodes, result = []) {
  for (const node of nodes) {
    result.push(node);
    if (Array.isArray(node.children)) allNodes(node.children, result);
  }
  return result;
}

function styleText(declarations) {
  return declarations
    .filter((entry) => entry && entry[1] !== undefined && entry[1] !== null && entry[1] !== "")
    .map(([property, value]) => `${property}:${value}`)
    .join(";");
}

function paddingDeclarations(node) {
  const uniform = Number(node.padding) || 0;
  const widths=hasDesignStroke(node) && node.strokeAlign === "inside" ? designStrokeSides(node).map(s=>s.width) : [0,0,0,0];
  if(widths.some((width,i)=>width>(node[`padding${["Top","Right","Bottom","Left"][i]}`]??uniform)))
    throw new Error(`${node.name}: 内侧边框宽度大于有效 padding，CSS 流式边框不能保留该原生重叠；请增加 padding 后导出`);
  return [
    ["padding-top", cssNumber(Math.max(0,(node.paddingTop ?? uniform)-widths[0]))],
    ["padding-right", cssNumber(Math.max(0,(node.paddingRight ?? uniform)-widths[1]))],
    ["padding-bottom", cssNumber(Math.max(0,(node.paddingBottom ?? uniform)-widths[2]))],
    ["padding-left", cssNumber(Math.max(0,(node.paddingLeft ?? uniform)-widths[3]))],
  ];
}

function alignment(value) {
  if (value === "start") return "flex-start";
  if (value === "end") return "flex-end";
  return value || "flex-start";
}

function positionDeclarations(node, parent, parentUsesLayout, canvas) {
  const flowOwned = parentUsesLayout && node.layoutPositioning !== "absolute";
  if (flowOwned) return [["position", "relative"]];

  const parentX = Number(parent?.x) || 0;
  const parentY = Number(parent?.y) || 0;
  const border=parent && hasDesignStroke(parent) && parent.strokeAlign === "inside" ? designStrokeSides(parent).map(s=>s.width) : [0,0,0,0];
  const localLeft = (Number(node.x) || 0) - parentX-border[3];
  const localTop = (Number(node.y) || 0) - parentY-border[0];
  const parentWidth=Number(parent?.width??canvas?.width)-border[1]-border[3];
  const parentHeight=Number(parent?.height??canvas?.height)-border[0]-border[2];
  const declarations = [["position", "absolute"]];
  const horizontal = node.constraintHorizontal;
  const vertical = node.constraintVertical;
  const rootFillHorizontal =
    !parent &&
    node.layoutSizingHorizontal === "fill" &&
    Number(node.width) <= Number(canvas?.width) + 1;
  const rootFillVertical =
    !parent &&
    node.layoutSizingVertical === "fill" &&
    Number(node.height) <= Number(canvas?.height) + 1;

  if (horizontal === "stretch" || rootFillHorizontal) {
    declarations.push(
      ["left", cssNumber(node.constraintLeft !== undefined ? node.constraintLeft-border[3] : localLeft)],
      [
        "right",
        cssNumber(
          node.constraintRight !== undefined ? node.constraintRight-border[1] :
            Math.max(0,parentWidth-localLeft-Number(node.width)+border[1])-border[1],
        ),
      ],
    );
  } else if (horizontal === "end") {
    declarations.push(["right", cssNumber((node.constraintRight ?? 0)-border[1])]);
  } else if (horizontal === "center") {
    const initialParentWidth = parentWidth || 0;
    const offset = localLeft + Number(node.width) / 2 - initialParentWidth / 2;
    declarations.push(["left", `calc(50% + ${cssNumber(offset)})`]);
  } else {
    declarations.push(["left", cssNumber(node.constraintLeft !== undefined ? node.constraintLeft-border[3] : localLeft)]);
  }

  if (vertical === "stretch" || rootFillVertical) {
    declarations.push(
      ["top", cssNumber(node.constraintTop !== undefined ? node.constraintTop-border[0] : localTop)],
      [
        "bottom",
        cssNumber(
          node.constraintBottom !== undefined ? node.constraintBottom-border[2] :
            Math.max(0,parentHeight-localTop-Number(node.height)+border[2])-border[2],
        ),
      ],
    );
  } else if (vertical === "end") {
    declarations.push(["bottom", cssNumber((node.constraintBottom ?? 0)-border[2])]);
  } else if (vertical === "center") {
    const initialParentHeight = parentHeight || 0;
    const offset = localTop + Number(node.height) / 2 - initialParentHeight / 2;
    declarations.push(["top", `calc(50% + ${cssNumber(offset)})`]);
  } else {
    declarations.push(["top", cssNumber(node.constraintTop !== undefined ? node.constraintTop-border[0] : localTop)]);
  }
  return declarations;
}

function sizingDeclarations(node, parent) {
  const parentLayout = node.layoutPositioning === "absolute" ? "none" : parent?.layout ?? "none";
  const horizontal = node.layoutSizingHorizontal ?? "fixed";
  const vertical = node.layoutSizingVertical ?? "fixed";
  const declarations = [];
  const fillBasis = (axis) => {
    const extra = strokeLayoutBasisExtra(node, axis);
    if (!extra) return "0";
    const sides = axis === "horizontal" ? ["Left", "Right"] : ["Top", "Bottom"];
    // flex-basis obeys this element's border-box sizing. Add the already
    // physical canonical inset so the requested extra remains content space.
    return cssNumber(extra + sides.reduce((sum, side) => sum + (node[`padding${side}`] ?? node.padding ?? 0), 0));
  };
  const absolute = node.layoutPositioning === "absolute" || parentLayout === "none" || !parent;
  const hasIntrinsicHorizontalContent =
    node.type === "text" ||
    (CONTAINER_TYPES.has(node.type) && ["horizontal", "vertical", "grid"].includes(node.layout));
  const hasIntrinsicVerticalContent = hasIntrinsicHorizontalContent;
  const flowChildren = Array.isArray(node.children)
    ? node.children.filter(
        (child) => child.visible !== false && child.layoutPositioning !== "absolute",
      )
    : [];
  const gridItems =
    node.layout === "grid"
      ? gridPlacements(flowChildren, node.gridColumns ?? 1, node).placements
      : [];
  const circularFill = (child, axis) => {
    if (child[`layoutSizing${axis}`] !== "fill") return false;
    if (axis === "Vertical" && gridFillHugContentHeight(node, child) !== null) return false;
    const tracks = node[axis === "Horizontal" ? "gridColumnSizes" : "gridRowSizes"];
    const item = gridItems.find((entry) => entry.child === child);
    if (!tracks || !item) return true;
    const start = axis === "Horizontal" ? item.column : item.row;
    const span = axis === "Horizontal" ? item.columnSpan : item.rowSpan;
    return tracks.slice(start, start + span).some((track) => track.type !== "fixed");
  };
  const circularHorizontalHug = flowChildren.some((child) => circularFill(child, "Horizontal"));
  const circularVerticalHug = flowChildren.some((child) => circularFill(child, "Vertical"));
  const followsParentAlignment = !node.layoutAlignSelf || node.layoutAlignSelf === "auto";
  const parentStretchesHorizontal =
    followsParentAlignment &&
    ["vertical", "grid"].includes(parentLayout) &&
    parent.alignItems === "stretch";
  const parentStretchesVertical =
    followsParentAlignment &&
    ["horizontal", "grid"].includes(parentLayout) &&
    parent.alignItems === "stretch";

  if (absolute && (node.constraintHorizontal === "stretch" || (!parent && horizontal === "fill"))) {
    // Left/right constraints own width.
  } else if (parentStretchesHorizontal) {
    declarations.push(["width", "auto"], ["align-self", "stretch"]);
  } else if (horizontal === "hug" && hasIntrinsicHorizontalContent && !circularHorizontalHug) {
    declarations.push(["width", "fit-content"]);
  } else if (horizontal === "fill" && ["horizontal", "vertical"].includes(parentLayout)) {
    if (parentLayout === "horizontal") declarations.push(["flex", `1 1 ${fillBasis("horizontal")}`], ["min-width", "0"]);
    else declarations.push(["align-self", "stretch"], ["width", "100%"]);
  } else if (horizontal === "fill" && parentLayout === "grid") {
    declarations.push(["width", "auto"], ["justify-self", "stretch"]);
  } else {
    declarations.push(["width", cssNumber(node.width, 1)]);
  }

  if (absolute && (node.constraintVertical === "stretch" || (!parent && vertical === "fill"))) {
    // Top/bottom constraints own height.
  } else if (parentStretchesVertical) {
    declarations.push(["height", "auto"], ["align-self", "stretch"]);
  } else if (vertical === "hug" && hasIntrinsicVerticalContent && !circularVerticalHug) {
    declarations.push(["height", "fit-content"]);
  } else if (vertical === "fill" && parentLayout === "vertical") {
    declarations.push(["flex", `1 1 ${fillBasis("vertical")}`], ["min-height", "0"]);
  } else if (vertical === "fill" && parentLayout === "horizontal") {
    declarations.push(["align-self", "stretch"], ["height", "auto"]);
  } else if (vertical === "fill" && parentLayout === "grid") {
    declarations.push(["height", "auto"], ["align-self", "stretch"]);
  } else {
    declarations.push(["height", cssNumber(node.height, 1)]);
  }

  if (node.layoutAlignSelf && node.layoutAlignSelf !== "auto") {
    declarations.push(["align-self", alignment(node.layoutAlignSelf)]);
  }
  if (node.layoutMarginBefore === "auto") {
    declarations.push([parentLayout === "vertical" ? "margin-top" : "margin-left", "auto"]);
  }
  if (!absolute && ["horizontal", "vertical"].includes(parentLayout) && mainAxisGap(parent) < 0) {
    const siblings = parent.children.filter((child) => child.visible !== false && child.layoutPositioning !== "absolute");
    if (siblings.at(-1)?.id !== node.id)
      declarations.push([parentLayout === "horizontal" ? "margin-right" : "margin-bottom", cssNumber(mainAxisGap(parent))]);
    // Fixed children must keep their authored border-box size under overflow.
    if ((parentLayout === "horizontal" ? horizontal : vertical) !== "fill") declarations.push(["flex-shrink", "0"]);
  }
  if (parentLayout === "grid") {
    declarations.push(
      [
        "grid-column",
        `${parent.gridItemsPositioning === "manual" && Number.isInteger(node.gridColumnAnchorIndex) ? `${node.gridColumnAnchorIndex + 1} / ` : ""}span ${Math.max(1, Number(node.gridColumnSpan) || 1)}`,
      ],
      [
        "grid-row",
        `${parent.gridItemsPositioning === "manual" && Number.isInteger(node.gridRowAnchorIndex) ? `${node.gridRowAnchorIndex + 1} / ` : ""}span ${Math.max(1, Number(node.gridRowSpan) || 1)}`,
      ],
    );
    for (const [axis, css] of [
      ["Horizontal", "justify-self"],
      ["Vertical", "align-self"],
    ]) {
      const value = node[`gridChild${axis}Align`];
      if (value && value !== "auto" && node[`layoutSizing${axis}`] !== "fill")
        declarations.push([css, alignment(value)]);
    }
  }
  if (Number.isFinite(Number(node.minWidth))) {
    declarations.push(["min-width", cssNumber(node.minWidth)]);
  }
  if (Number.isFinite(Number(node.maxWidth))) {
    declarations.push(["max-width", cssNumber(node.maxWidth)]);
  }
  if (Number.isFinite(Number(node.minHeight))) {
    declarations.push(["min-height", cssNumber(node.minHeight)]);
  }
  if (Number.isFinite(Number(node.maxHeight))) {
    declarations.push(["max-height", cssNumber(node.maxHeight)]);
  }
  return declarations;
}

function layoutDeclarations(node) {
  if (!CONTAINER_TYPES.has(node.type) || node.layout === "none") return [];
  if (node.layout === "grid") {
    const rows = effectiveGridRows(
      node,
      gridPlacements(
        (node.children ?? []).filter((child) => child.visible !== false),
        node.gridColumns ?? 1,
        node,
      ).rowCount,
    );
    const rowTracks = effectiveGridRowTracks(node, rows);
    return [
      ["display", "grid"],
      [
        "grid-template-columns",
        node.gridColumnSizes?.map(cssGridTrack).join(" ") ??
          `repeat(${Math.max(1, Number(node.gridColumns) || 1)}, minmax(0, 1fr))`,
      ],
      ...(rowTracks
        ? [["grid-template-rows", rowTracks.map(cssGridTrack).join(" ")]]
        : node.gridRows || node.gridAutoTracks === "rows"
          ? [["grid-template-rows", `repeat(${rows}, auto)`]]
          : []),
      ["grid-auto-flow", node.gridItemsPositioning ? "row" : "row dense"],
      ["row-gap", cssNumber(Math.max(0, node.rowGap ?? node.gap))],
      ["column-gap", cssNumber(Math.max(0, node.columnGap ?? node.gap))],
      ["align-items", alignment(node.alignItems)],
      ["align-content", alignment(node.alignContent)],
      ["justify-content", alignment(node.justifyContent)],
      ...paddingDeclarations(node),
    ];
  }
  return [
    ["display", "flex"],
    [
      "flex-direction",
      `${node.layout === "vertical" ? "column" : "row"}${node.layoutReverse ? "-reverse" : ""}`,
    ],
    [
      "flex-wrap",
      node.layoutWrap === "wrap-reverse"
        ? "wrap-reverse"
        : node.layoutWrap === "wrap"
          ? "wrap"
          : "nowrap",
    ],
    ["row-gap", cssNumber(Math.max(0, node.rowGap ?? node.gap))],
    ["column-gap", cssNumber(Math.max(0, node.columnGap ?? node.gap))],
    ["align-items", alignment(node.alignItems)],
    ["align-content", alignment(node.alignContent)],
    ["justify-content", alignment(node.justifyContent)],
    ...paddingDeclarations(node),
  ];
}

function paintDeclarations(node) {
  if (PAINTLESS_TYPES.has(node.type)) return [];
  const declarations = [
    ["background", node.fillPaints ? designPaintCssImage(node) : cssColor(node.fill)],
  ];
  const shadows=[];
  if (hasDesignStroke(node) && node.strokeAlign === "inside") {
    designStrokeSides(node).forEach((side,i)=>{
      const rgb=[1,3,5].map(offset=>parseInt(side.color.slice(offset,offset+2),16));
      declarations.push([`border-${["top","right","bottom","left"][i]}`,`${cssNumber(side.width)} solid rgba(${rgb.join(",")},${side.opacity})`]);
    });
  } else if (hasDesignStroke(node)) {
    const sides=designStrokeSides(node),side=sides[0];
    if(sides.some(s=>s.width!==side.width || s.color!==side.color || s.opacity!==side.opacity))
      throw new Error(`${node.name}: 非内侧的独立侧边暂不能导出为等价 CSS；请保留 SVG/v3 或使用内侧边框`);
    const rgba=`rgba(${[1,3,5].map(offset=>parseInt(side.color.slice(offset,offset+2),16)).join(",")},${side.opacity})`;
    const outside=node.strokeAlign === "outside"?side.width:side.width/2;
    declarations.push(["outline",`${cssNumber(outside)} solid ${rgba}`]);
    if(node.strokeAlign!=="outside")shadows.push(`inset 0 0 0 ${cssNumber(side.width/2)} ${rgba}`);
  } else if (Number(node.strokeWidth) > 0 && cssColor(node.stroke) !== "transparent") {
    declarations.push(["border", `${cssNumber(node.strokeWidth)} solid ${cssColor(node.stroke)}`]);
  }
  if (node.cornerRadii) {
    declarations.push(["border-radius", node.cornerRadii.map(cssNumber).join(" ")]);
  } else if (Number(node.cornerRadius) > 0) {
    declarations.push(["border-radius", cssNumber(node.cornerRadius)]);
  }
  if (node.type === "ellipse") declarations.push(["border-radius", "50%"]);
  if (node.shadow) {
    shadows.push(`${cssNumber(node.shadow.x)} ${cssNumber(node.shadow.y)} ${cssNumber(node.shadow.blur)} rgba(${Number.parseInt(node.shadow.color.slice(1, 3), 16)},${Number.parseInt(node.shadow.color.slice(3, 5), 16)},${Number.parseInt(node.shadow.color.slice(5, 7), 16)},${node.shadow.opacity})`);
  }
  if(shadows.length)declarations.push(["box-shadow",shadows.join(",")]);
  return declarations;
}

function transformDeclarations(node) {
  const transforms = [];
  if (node.constraintHorizontal === "center") transforms.push("translateX(-50%)");
  if (node.constraintVertical === "center") transforms.push("translateY(-50%)");
  if (Number(node.rotation)) transforms.push(`rotate(${Number(node.rotation)}deg)`);
  return transforms.length > 0 ? [["transform", transforms.join(" ")]] : [];
}

function nodeStyle(node, parent, canvas) {
  const parentUsesLayout =
    CONTAINER_TYPES.has(parent?.type) && ["horizontal", "vertical", "grid"].includes(parent.layout);
  const declarations = [
    ...positionDeclarations(node, parent, parentUsesLayout, canvas),
    ...sizingDeclarations(node, parent),
    ...layoutDeclarations(node),
    ...paintDeclarations(node),
    ...transformDeclarations(node),
    ["box-sizing", "border-box"],
    ["opacity", String(Number.isFinite(Number(node.opacity)) ? Number(node.opacity) : 1)],
    ["overflow", node.clipContent || node.textOverflow === "ellipsis" ? "hidden" : "visible"],
    ["display", node.visible === false ? "none" : undefined],
  ];
  if (node.type === "text") {
    declarations.push(
      ["color", node.fillPaints ? "transparent" : cssColor(node.fill, "#000000")],
      ["background", node.fillPaints ? designPaintCssImage(node) : "transparent"],
      ["background-clip", node.fillPaints ? "text" : undefined],
      ["-webkit-background-clip", node.fillPaints ? "text" : undefined],
      ["font-family", designFontFamilyCss(node.fontFamily)],
      ["font-size", cssNumber(node.fontSize, 16)],
      ["font-weight", String(node.fontWeight ?? 400)],
      ["font-style", node.fontStyle ?? "normal"],
      ["line-height", String(node.lineHeight ?? 1.2)],
      ["letter-spacing", cssNumber(node.letterSpacing, 0)],
      ["text-align", node.textAlign ?? "left"],
      ["text-decoration", node.textDecoration ?? "none"],
      ["white-space", node.textOverflow === "ellipsis" ? "pre" : node.textFlow === "wrap" ? "pre-wrap" : "pre"],
      ["text-overflow", node.textOverflow === "ellipsis" ? "ellipsis" : undefined],
      ["overflow-wrap", node.textFlow === "wrap" ? "anywhere" : "normal"],
    );
  }
  return styleText(declarations);
}

function renderInstance(node, context) {
  const master = context.components.get(node.componentId);
  if (!master || context.instanceDepth >= 16) return "";
  const scaleX = Number(node.width) / Math.max(1, Number(master.width));
  const scaleY = Number(node.height) / Math.max(1, Number(master.height));
  const contentStyle = styleText([
    ["position", "absolute"],
    ["left", "0"],
    ["top", "0"],
    ["width", cssNumber(master.width, 1)],
    ["height", cssNumber(master.height, 1)],
    ["transform-origin", "0 0"],
    ["transform", `scale(${scaleX},${scaleY})`],
    ...paintDeclarations(master),
    ...layoutDeclarations(master),
  ]);
  const children = (master.children ?? [])
    .map((child) =>
      renderNode(child, master, {
        ...context,
        instanceDepth: context.instanceDepth + 1,
        idPrefix: `${context.idPrefix}${node.id}--`,
      }),
    )
    .join("");
  return `<div class="cs-instance-content" style="${contentStyle}">${children}</div>`;
}

function renderNode(node, parent, context) {
  const exportedId = `${context.idPrefix}${node.id}`;
  const attributes = [
    `class="cs-node cs-${escapeHtml(node.type)}"`,
    `data-codeshell-id="${escapeHtml(exportedId)}"`,
    `data-codeshell-source-id="${escapeHtml(node.id)}"`,
    `data-codeshell-node-type="${escapeHtml(node.type)}"`,
    `data-codeshell-name="${escapeHtml(node.name)}"`,
    `style="${escapeHtml(nodeStyle(node, parent, context.canvas))}"`,
  ];
  if (node.notes) attributes.push(`title="${escapeHtml(node.notes)}"`);
  const link = context.idPrefix === "" ? context.prototypeLinks?.get(node.id) : null;
  const hotspot = link
    ? `<a class="cs-prototype-hotspot" data-prototype-link="${escapeHtml(link.id)}" href="${escapeHtml(link.href)}" aria-label="${escapeHtml(link.label || node.name)}"${link.external ? ' target="_blank" rel="noopener noreferrer"' : ""}></a>`
    : "";
  if (node.type === "text") {
    return `<div ${attributes.join(" ")}>${hotspot}${escapeHtml(node.textOverflow === "ellipsis" ? nativeTextContent(node) : node.text)}</div>`;
  }
  if (node.type === "image") {
    const source = context.resourceDataUrls.get(node.imageRef);
    if (source) {
      const imageAttributes = attributes.filter((attribute) => !attribute.startsWith("style="));
      imageAttributes.push(
        `style="${escapeHtml(`${nodeStyle(node, parent, context.canvas)};object-fit:${node.objectFit ?? "cover"}`)}"`,
      );
      if (context.prototypeMode) {
        return `<div ${attributes.join(" ")}>${hotspot}<img class="cs-prototype-image" src="${escapeHtml(source)}" alt="${escapeHtml(node.name)}" style="width:100%;height:100%;object-fit:${escapeHtml(node.objectFit ?? "cover")}"></div>`;
      }
      return `<img ${imageAttributes.join(" ")} src="${escapeHtml(source)}" alt="${escapeHtml(node.name)}">`;
    }
  }
  let content = "";
  if (node.type === "instance") {
    content = renderInstance(node, context);
  } else if (Array.isArray(node.children)) {
    content = node.children.map((child) => renderNode(child, node, context)).join("");
  }
  return `<div ${attributes.join(" ")}>${hotspot}${content}</div>`;
}

export function isSafeFrontendPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes(":") &&
    !value.includes("?") &&
    !value.includes("#") &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    /\.html?$/iu.test(value) &&
    value.split("/").every((part) => part && part !== "." && part !== ".." && !part.startsWith("."))
  );
}

export function renderDesignFrontendPage(
  design,
  {
    pageId = design?.activePageId,
    resourceDataUrls = new Map(),
    prototypeLinks,
    prototypeMode = false,
  } = {},
) {
  if (!design || design.format !== "codeshell.design" || design.version !== 3) {
    throw new Error("前端导出需要 codeshell.design v3 文档");
  }
  const page = design.pages?.find((candidate) => candidate.id === pageId);
  if (!page) throw new Error(`设计页面不存在：${pageId}`);
  const canvas = design.canvas ?? { width: 1440, height: 900, background: "#ffffff" };
  const roots = pageChildren(page);
  const components = new Map(
    design.pages
      .flatMap((candidate) => allNodes(pageChildren(candidate)))
      .filter((node) => node.type === "component")
      .map((node) => [node.id, node]),
  );
  const context = {
    canvas,
    components,
    resourceDataUrls:
      resourceDataUrls instanceof Map
        ? resourceDataUrls
        : new Map(Object.entries(resourceDataUrls)),
    instanceDepth: 0,
    idPrefix: "",
    prototypeLinks,
    prototypeMode,
  };
  const body = roots.map((node) => renderNode(node, null, context)).join("\n");
  return `<main class="cs-page" data-codeshell-page-id="${escapeHtml(page.id)}" data-codeshell-name="${escapeHtml(page.name)}">
${body}
    </main>`;
}

export function exportDesignFrontend(
  design,
  { pageId = design?.activePageId, resourceDataUrls = new Map(), title } = {},
) {
  const pageMarkup = renderDesignFrontendPage(design, { pageId, resourceDataUrls });
  const page = design.pages.find((candidate) => candidate.id === pageId);
  const canvas = design.canvas ?? { width: 1440, height: 900, background: "#ffffff" };
  const documentTitle = title || `${design.name} · ${page.name}`;
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(documentTitle)}</title>
    <style>
      ${designFontFaceCss(design.resources, resourceDataUrls)}
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      html, body { min-height: 100%; margin: 0; }
      body { background: ${cssColor(canvas.background, "#ffffff")}; }
      .cs-page {
        position: relative;
        width: min(100%, ${cssNumber(canvas.width)});
        min-width: 0;
        height: ${cssNumber(canvas.height)};
        margin: 0 auto;
        overflow: hidden;
        background: ${cssColor(canvas.background, "#ffffff")};
      }
      .cs-node { min-width: 0; }
      .cs-text { margin: 0; }
      .cs-image { display: block; }
      .cs-instance-content { pointer-events: none; }
    </style>
  </head>
  <body>
    ${pageMarkup}
  </body>
</html>
`;
}
