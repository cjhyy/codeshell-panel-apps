/* Deterministic CodeShell Design v3 to editable HTML/CSS export. */

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
  return [
    ["padding-top", cssNumber(node.paddingTop ?? uniform)],
    ["padding-right", cssNumber(node.paddingRight ?? uniform)],
    ["padding-bottom", cssNumber(node.paddingBottom ?? uniform)],
    ["padding-left", cssNumber(node.paddingLeft ?? uniform)],
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
  const localLeft = (Number(node.x) || 0) - parentX;
  const localTop = (Number(node.y) || 0) - parentY;
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
      ["left", cssNumber(node.constraintLeft ?? localLeft)],
      [
        "right",
        cssNumber(
          node.constraintRight ??
            Math.max(0, Number(parent?.width ?? canvas?.width) - localLeft - Number(node.width)),
        ),
      ],
    );
  } else if (horizontal === "end") {
    declarations.push(["right", cssNumber(node.constraintRight ?? 0)]);
  } else if (horizontal === "center") {
    const initialParentWidth = Number(parent?.width ?? canvas?.width) || 0;
    const offset = localLeft + Number(node.width) / 2 - initialParentWidth / 2;
    declarations.push(["left", `calc(50% + ${cssNumber(offset)})`]);
  } else {
    declarations.push(["left", cssNumber(node.constraintLeft ?? localLeft)]);
  }

  if (vertical === "stretch" || rootFillVertical) {
    declarations.push(
      ["top", cssNumber(node.constraintTop ?? localTop)],
      [
        "bottom",
        cssNumber(
          node.constraintBottom ??
            Math.max(0, Number(parent?.height ?? canvas?.height) - localTop - Number(node.height)),
        ),
      ],
    );
  } else if (vertical === "end") {
    declarations.push(["bottom", cssNumber(node.constraintBottom ?? 0)]);
  } else if (vertical === "center") {
    const initialParentHeight = Number(parent?.height ?? canvas?.height) || 0;
    const offset = localTop + Number(node.height) / 2 - initialParentHeight / 2;
    declarations.push(["top", `calc(50% + ${cssNumber(offset)})`]);
  } else {
    declarations.push(["top", cssNumber(node.constraintTop ?? localTop)]);
  }
  return declarations;
}

function sizingDeclarations(node, parent) {
  const parentLayout = parent?.layout ?? "none";
  const horizontal = node.layoutSizingHorizontal ?? "fixed";
  const vertical = node.layoutSizingVertical ?? "fixed";
  const declarations = [];
  const absolute = node.layoutPositioning === "absolute" || parentLayout === "none" || !parent;
  const hasIntrinsicHorizontalContent =
    node.type === "text" ||
    (CONTAINER_TYPES.has(node.type) &&
      ["horizontal", "vertical", "grid"].includes(node.layout));
  const hasIntrinsicVerticalContent = hasIntrinsicHorizontalContent;
  const flowChildren = Array.isArray(node.children)
    ? node.children.filter(
        (child) => child.visible !== false && child.layoutPositioning !== "absolute",
      )
    : [];
  const circularHorizontalHug = flowChildren.some(
    (child) => child.layoutSizingHorizontal === "fill",
  );
  const circularVerticalHug = flowChildren.some(
    (child) => child.layoutSizingVertical === "fill",
  );
  const followsParentAlignment =
    !node.layoutAlignSelf || node.layoutAlignSelf === "auto";
  const parentStretchesHorizontal =
    followsParentAlignment &&
    ["vertical", "grid"].includes(parentLayout) &&
    parent.alignItems === "stretch";
  const parentStretchesVertical =
    followsParentAlignment &&
    ["horizontal", "grid"].includes(parentLayout) &&
    parent.alignItems === "stretch";

  if (
    absolute &&
    (node.constraintHorizontal === "stretch" ||
      (!parent && horizontal === "fill"))
  ) {
    // Left/right constraints own width.
  } else if (parentStretchesHorizontal) {
    declarations.push(["width", "auto"], ["align-self", "stretch"]);
  } else if (
    horizontal === "hug" &&
    hasIntrinsicHorizontalContent &&
    !circularHorizontalHug
  ) {
    declarations.push(["width", "fit-content"]);
  } else if (horizontal === "fill" && ["horizontal", "vertical"].includes(parentLayout)) {
    if (parentLayout === "horizontal") declarations.push(["flex", "1 1 0"], ["min-width", "0"]);
    else declarations.push(["align-self", "stretch"], ["width", "auto"]);
  } else if (horizontal === "fill" && parentLayout === "grid") {
    declarations.push(["width", "auto"], ["justify-self", "stretch"]);
  } else {
    declarations.push(["width", cssNumber(node.width, 1)]);
  }

  if (
    absolute &&
    (node.constraintVertical === "stretch" ||
      (!parent && vertical === "fill"))
  ) {
    // Top/bottom constraints own height.
  } else if (parentStretchesVertical) {
    declarations.push(["height", "auto"], ["align-self", "stretch"]);
  } else if (
    vertical === "hug" &&
    hasIntrinsicVerticalContent &&
    !circularVerticalHug
  ) {
    declarations.push(["height", "fit-content"]);
  } else if (vertical === "fill" && parentLayout === "vertical") {
    declarations.push(["flex", "1 1 0"], ["min-height", "0"]);
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
  if (parentLayout === "grid") {
    declarations.push(
      ["grid-column", `span ${Math.max(1, Number(node.gridColumnSpan) || 1)}`],
      ["grid-row", `span ${Math.max(1, Number(node.gridRowSpan) || 1)}`],
    );
  }
  return declarations;
}

function layoutDeclarations(node) {
  if (!CONTAINER_TYPES.has(node.type) || node.layout === "none") return [];
  if (node.layout === "grid") {
    return [
      ["display", "grid"],
      ["grid-template-columns", `repeat(${Math.max(1, Number(node.gridColumns) || 1)}, minmax(0, 1fr))`],
      ["row-gap", cssNumber(node.rowGap ?? node.gap)],
      ["column-gap", cssNumber(node.columnGap ?? node.gap)],
      ["align-items", alignment(node.alignItems)],
      ["align-content", alignment(node.alignContent)],
      ["justify-content", alignment(node.justifyContent)],
      ...paddingDeclarations(node),
    ];
  }
  return [
    ["display", "flex"],
    ["flex-direction", node.layout === "vertical" ? "column" : "row"],
    ["flex-wrap", node.layoutWrap === "wrap" ? "wrap" : "nowrap"],
    ["row-gap", cssNumber(node.rowGap ?? node.gap)],
    ["column-gap", cssNumber(node.columnGap ?? node.gap)],
    ["align-items", alignment(node.alignItems)],
    ["align-content", alignment(node.alignContent)],
    ["justify-content", alignment(node.justifyContent)],
    ...paddingDeclarations(node),
  ];
}

function paintDeclarations(node) {
  if (PAINTLESS_TYPES.has(node.type)) return [];
  const declarations = [["background", cssColor(node.fill)]];
  if (Number(node.strokeWidth) > 0 && cssColor(node.stroke) !== "transparent") {
    declarations.push(["border", `${cssNumber(node.strokeWidth)} solid ${cssColor(node.stroke)}`]);
  }
  if (Number(node.cornerRadius) > 0) {
    declarations.push(["border-radius", cssNumber(node.cornerRadius)]);
  }
  if (node.type === "ellipse") declarations.push(["border-radius", "50%"]);
  if (node.shadow) {
    declarations.push([
      "box-shadow",
      `${cssNumber(node.shadow.x)} ${cssNumber(node.shadow.y)} ${cssNumber(node.shadow.blur)} rgba(${Number.parseInt(node.shadow.color.slice(1, 3), 16)},${Number.parseInt(node.shadow.color.slice(3, 5), 16)},${Number.parseInt(node.shadow.color.slice(5, 7), 16)},${node.shadow.opacity})`,
    ]);
  }
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
    ["overflow", node.clipContent ? "hidden" : "visible"],
    ["display", node.visible === false ? "none" : undefined],
  ];
  if (node.type === "text") {
    declarations.push(
      ["color", cssColor(node.fill, "#000000")],
      ["background", "transparent"],
      ["font-family", node.fontFamily || "Inter, ui-sans-serif, system-ui, sans-serif"],
      ["font-size", cssNumber(node.fontSize, 16)],
      ["font-weight", String(node.fontWeight ?? 400)],
      ["font-style", node.fontStyle ?? "normal"],
      ["line-height", String(node.lineHeight ?? 1.2)],
      ["letter-spacing", cssNumber(node.letterSpacing, 0)],
      ["text-align", node.textAlign ?? "left"],
      ["text-decoration", node.textDecoration ?? "none"],
      ["white-space", node.textFlow === "wrap" ? "pre-wrap" : "pre"],
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
  if (node.type === "text") {
    return `<div ${attributes.join(" ")}>${escapeHtml(node.text)}</div>`;
  }
  if (node.type === "image") {
    const source = context.resourceDataUrls.get(node.imageRef);
    if (source) {
      const imageAttributes = attributes.filter((attribute) => !attribute.startsWith("style="));
      imageAttributes.push(
        `style="${escapeHtml(`${nodeStyle(node, parent, context.canvas)};object-fit:${node.objectFit ?? "cover"}`)}"`,
      );
      return `<img ${imageAttributes.join(" ")} src="${escapeHtml(source)}" alt="${escapeHtml(node.name)}">`;
    }
  }
  let content = "";
  if (node.type === "instance") {
    content = renderInstance(node, context);
  } else if (Array.isArray(node.children)) {
    content = node.children.map((child) => renderNode(child, node, context)).join("");
  }
  return `<div ${attributes.join(" ")}>${content}</div>`;
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

export function exportDesignFrontend(
  design,
  { pageId = design?.activePageId, resourceDataUrls = new Map(), title } = {},
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
      resourceDataUrls instanceof Map ? resourceDataUrls : new Map(Object.entries(resourceDataUrls)),
    instanceDepth: 0,
    idPrefix: "",
  };
  const body = roots.map((node) => renderNode(node, null, context)).join("\n");
  const documentTitle = title || `${design.name} · ${page.name}`;
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(documentTitle)}</title>
    <style>
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
    <main class="cs-page" data-codeshell-page-id="${escapeHtml(page.id)}" data-codeshell-name="${escapeHtml(page.name)}">
${body}
    </main>
  </body>
</html>
`;
}
