/* Browser-rendered HTML to CodeShell Design v3 capture. */

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const SVG_NS = "http://www.w3.org/2000/svg";
const hangingBaselineOffsets = new WeakMap();

function round(value, precision = 2) {
  const factor = 10 ** precision;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function byteToHex(value) {
  return Math.round(clamp(value, 0, 255))
    .toString(16)
    .padStart(2, "0");
}

export function parseCssColor(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "transparent") {
    return { hex: "#000000", alpha: 0 };
  }
  const hex = normalized.match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/u);
  if (hex) {
    const body =
      hex[1].length === 3 ? [...hex[1]].map((character) => character.repeat(2)).join("") : hex[1];
    return {
      hex: `#${body.slice(0, 6)}`,
      alpha: body.length === 8 ? Number.parseInt(body.slice(6), 16) / 255 : 1,
    };
  }
  const rgb = normalized.match(
    /^rgba?\(\s*([-\d.]+)(?:\s*,\s*|\s+)([-\d.]+)(?:\s*,\s*|\s+)([-\d.]+)(?:\s*(?:,|\/)\s*([-\d.]+%?))?\s*\)$/u,
  );
  if (!rgb) return null;
  const alphaValue = rgb[4] === undefined ? 1 : Number.parseFloat(rgb[4]);
  const alpha = rgb[4]?.endsWith?.("%") ? alphaValue / 100 : alphaValue;
  return {
    hex: `#${byteToHex(Number(rgb[1]))}${byteToHex(Number(rgb[2]))}${byteToHex(Number(rgb[3]))}`,
    alpha: clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1),
  };
}

function pixelValue(value, fallback = 0) {
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fontWeight(value) {
  if (value === "normal") return 400;
  if (value === "bold") return 700;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 400;
  return clamp(Math.round(parsed / 100) * 100, 100, 900);
}

function textDecoration(value) {
  if (value?.includes("line-through")) return "line-through";
  if (value?.includes("underline")) return "underline";
  return "none";
}

function hangingBaselineOffset(style, size, spacing, ownerDocument) {
  let documentOffsets = hangingBaselineOffsets.get(ownerDocument);
  if (!documentOffsets) {
    documentOffsets = new Map();
    hangingBaselineOffsets.set(ownerDocument, documentOffsets);
  }
  const key = [style.fontFamily, size, fontWeight(style.fontWeight), style.fontStyle, spacing].join(
    "|",
  );
  const cached = documentOffsets.get(key);
  if (cached !== undefined) return cached;

  const svg = ownerDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "200");
  svg.setAttribute("height", "200");
  svg.style.cssText =
    "position:fixed;left:0;top:0;overflow:visible;visibility:hidden;pointer-events:none";
  const text = ownerDocument.createElementNS(SVG_NS, "text");
  text.setAttribute("x", "0");
  text.setAttribute("y", "100");
  text.setAttribute("dominant-baseline", "hanging");
  text.setAttribute("font-family", style.fontFamily);
  text.setAttribute("font-size", String(size));
  text.setAttribute("font-weight", String(fontWeight(style.fontWeight)));
  text.setAttribute("font-style", style.fontStyle === "italic" ? "italic" : "normal");
  text.setAttribute("letter-spacing", String(spacing));
  text.textContent = "Hg";
  svg.append(text);
  ownerDocument.body.append(svg);
  const rect = text.getBoundingClientRect();
  svg.remove();

  const measured = 100 - rect.top;
  const offset = round(Number.isFinite(measured) ? measured : size * 0.18, 4);
  documentOffsets.set(key, offset);
  return offset;
}

function transformedText(value, transform) {
  if (transform === "uppercase") return value.toUpperCase();
  if (transform === "lowercase") return value.toLowerCase();
  if (transform === "capitalize") {
    return value.replace(/\b\p{L}/gu, (character) => character.toUpperCase());
  }
  return value;
}

function relativeRect(rect, rootRect) {
  return {
    x: round(rect.left - rootRect.left),
    y: round(rect.top - rootRect.top),
    width: round(Math.max(1, rect.width)),
    height: round(Math.max(1, rect.height)),
  };
}

function intersectRects(left, right) {
  const intersection = {
    left: Math.max(left.left, right.left),
    top: Math.max(left.top, right.top),
    right: Math.min(left.right, right.right),
    bottom: Math.min(left.bottom, right.bottom),
  };
  if (
    intersection.right - intersection.left < 0.5 ||
    intersection.bottom - intersection.top < 0.5
  ) {
    return null;
  }
  return {
    ...intersection,
    width: intersection.right - intersection.left,
    height: intersection.bottom - intersection.top,
  };
}

function normalizedCaptureBounds(value) {
  if (value === undefined) return null;
  if (
    !value ||
    typeof value !== "object" ||
    ![value.left, value.top, value.right, value.bottom].every(Number.isFinite) ||
    value.right - value.left < 1 ||
    value.bottom - value.top < 1
  ) {
    throw new Error("captureHtmlToDesign captureBounds must be a non-empty browser rectangle");
  }
  return {
    left: value.left,
    top: value.top,
    right: value.right,
    bottom: value.bottom,
    width: value.right - value.left,
    height: value.bottom - value.top,
  };
}

function semanticSlug(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 72);
  return /^[a-z]/u.test(normalized) ? normalized : `html-${normalized || "node"}`;
}

function baseNode(id, type, name, rect) {
  return {
    id,
    type,
    name,
    ...rect,
    fill: "transparent",
    stroke: "transparent",
    strokeWidth: 0,
    opacity: 1,
    rotation: 0,
    cornerRadius: 0,
    visible: true,
    locked: false,
  };
}

function rectangleNode(id, name, rect, properties = {}) {
  return {
    ...baseNode(id, "rectangle", name, rect),
    ...properties,
  };
}

function frameNode(id, name, rect, properties = {}) {
  return {
    ...baseNode(id, "frame", name, rect),
    layout: "none",
    gap: 0,
    padding: 0,
    alignItems: "start",
    justifyContent: "start",
    children: [],
    ...properties,
  };
}

export function parseCssBoxShadow(value) {
  if (typeof value !== "string" || value === "none") return null;
  const first = value.split(/,(?![^()]*\))/u).find((shadow) => !shadow.includes("inset"));
  if (!first) return null;
  // Chromium serializes computed shadows with the color first, while authored
  // CSS commonly places it last. Accept both forms.
  const colorMatch = first.match(/rgba?\([^)]*\)|#[\da-f]{3,8}\b|transparent\b/iu);
  const color = parseCssColor(colorMatch?.[0] ?? "rgba(0, 0, 0, 0.2)");
  const numbers = first
    .replace(colorMatch?.[0] ?? "", "")
    .match(/-?[\d.]+px/gu)
    ?.map((part) => Number.parseFloat(part));
  if (!color || !numbers || numbers.length < 2) return null;
  return {
    color: color.hex,
    opacity: color.alpha,
    x: round(numbers[0] ?? 0),
    y: round(numbers[1] ?? 0),
    blur: round(Math.max(0, numbers[2] ?? 0)),
  };
}

function representativeCornerRadius(style) {
  const radii = [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ].map((value) => pixelValue(value));
  if (radii.every((value) => Math.abs(value - radii[0]) < 0.1)) return round(radii[0]);
  // v3 currently stores one radius. Pick the observed corner value with the
  // smallest squared error so a single exceptional corner does not square all
  // four corners (a common chat-bubble pattern).
  const best = radii.reduce((current, candidate) => {
    const score = radii.reduce((sum, value) => sum + (value - candidate) ** 2, 0);
    const currentScore = radii.reduce((sum, value) => sum + (value - current) ** 2, 0);
    return score < currentScore ? candidate : current;
  }, radii[0]);
  return round(best);
}

function isVisibleElement(element, style, rect) {
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number.parseFloat(style.opacity || "1") > 0 &&
    rect.width >= 0.5 &&
    rect.height >= 0.5 &&
    !element.hasAttribute("data-codeshell-capture-ignore")
  );
}

function textLineRects(node, rootRect, captureBounds = null) {
  const source = node.textContent ?? "";
  if (!source.trim()) return [];
  const range = node.ownerDocument.createRange();
  const lines = [];
  for (let index = 0; index < source.length; index += 1) {
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    const rect = range.getBoundingClientRect();
    if (rect.height < 0.5 || (!source[index].trim() && rect.width < 0.05)) continue;
    let line = lines.find((candidate) => Math.abs(candidate.top - rect.top) < 1.5);
    if (!line) {
      line = {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        text: "",
      };
      lines.push(line);
    }
    line.left = Math.min(line.left, rect.left);
    line.right = Math.max(line.right, rect.right);
    line.bottom = Math.max(line.bottom, rect.bottom);
    line.text += source[index];
  }
  range.detach();
  return lines
    .sort((left, right) => left.top - right.top || left.left - right.left)
    .filter(
      (line) =>
        !captureBounds ||
        intersectRects(
          {
            left: line.left,
            top: line.top,
            right: line.right,
            bottom: line.bottom,
          },
          captureBounds,
        ),
    )
    .map((line) => ({
      text: line.text.replace(/\s+/gu, " ").trim(),
      rect: relativeRect(
        {
          left: line.left,
          top: line.top,
          width: line.right - line.left,
          height: line.bottom - line.top,
        },
        rootRect,
      ),
    }))
    .filter((line) => line.text);
}

function borderSides(style) {
  return ["Top", "Right", "Bottom", "Left"]
    .map((side) => ({
      side: side.toLowerCase(),
      width: pixelValue(style[`border${side}Width`]),
      style: style[`border${side}Style`],
      color: parseCssColor(style[`border${side}Color`]),
    }))
    .filter(
      (border) =>
        border.width > 0 &&
        border.style !== "none" &&
        border.style !== "hidden" &&
        border.color &&
        border.color.alpha > 0,
    );
}

function flexAxis(value) {
  if (value === "row") return "horizontal";
  if (value === "column") return "vertical";
  return null;
}

function flexJustification(value) {
  if (["normal", "start", "flex-start"].includes(value)) return "start";
  if (["end", "flex-end"].includes(value)) return "end";
  if (value === "center") return "center";
  if (value === "space-between") return "space-between";
  return null;
}

function flexAlignment(value) {
  if (["normal", "stretch"].includes(value)) return "stretch";
  if (["start", "flex-start", "self-start"].includes(value)) return "start";
  if (["end", "flex-end", "self-end"].includes(value)) return "end";
  if (value === "center") return "center";
  return null;
}

function contentAlignment(value) {
  if (["normal", "start", "flex-start"].includes(value)) return "start";
  if (["end", "flex-end"].includes(value)) return "end";
  if (["center", "space-between", "stretch"].includes(value)) return value;
  return null;
}

function visibleElementChildren(element, ownerWindow) {
  return [...element.children].filter((child) => {
    const style = ownerWindow.getComputedStyle(child);
    const rect = child.getBoundingClientRect();
    return isVisibleElement(child, style, rect);
  });
}

function layoutInsets(style) {
  const border = (side) => {
    const borderStyle = style[`border${side}Style`];
    return ["none", "hidden"].includes(borderStyle)
      ? 0
      : Math.max(0, pixelValue(style[`border${side}Width`]));
  };
  return {
    top: Math.max(0, pixelValue(style.paddingTop)) + border("Top"),
    right: Math.max(0, pixelValue(style.paddingRight)) + border("Right"),
    bottom: Math.max(0, pixelValue(style.paddingBottom)) + border("Bottom"),
    left: Math.max(0, pixelValue(style.paddingLeft)) + border("Left"),
  };
}

function typedCssValue(element, property) {
  try {
    return element.computedStyleMap?.().get(property)?.toString?.() ?? "";
  } catch {
    return "";
  }
}

function cssSizeMode(element, property) {
  const value = typedCssValue(element, property).trim().toLowerCase();
  if (value === "auto" || value === "max-content" || value === "min-content") return "hug";
  const percentage = value.match(/^([-\d.]+)%$/u);
  if (percentage && Number.parseFloat(percentage[1]) >= 99) return "fill";
  return "fixed";
}

function insetIsSpecified(element, property) {
  const value = typedCssValue(element, property).trim().toLowerCase();
  return Boolean(value && value !== "auto");
}

function absoluteConstraintProperties(element) {
  const parentRect = element.parentElement?.getBoundingClientRect?.();
  if (!parentRect) return {};
  const childRect = element.getBoundingClientRect();
  const hasLeft = insetIsSpecified(element, "left");
  const hasRight = insetIsSpecified(element, "right");
  const hasTop = insetIsSpecified(element, "top");
  const hasBottom = insetIsSpecified(element, "bottom");
  const left = childRect.left - parentRect.left;
  const right = parentRect.right - childRect.right;
  const top = childRect.top - parentRect.top;
  const bottom = parentRect.bottom - childRect.bottom;
  const horizontallyCentered =
    !(hasLeft && hasRight) &&
    Math.abs(left - right) <= 3 &&
    left >= parentRect.width * 0.2;
  const verticallyCentered =
    !(hasTop && hasBottom) &&
    Math.abs(top - bottom) <= 3 &&
    top >= parentRect.height * 0.2;
  return {
    constraintHorizontal: hasLeft && hasRight
      ? "stretch"
      : horizontallyCentered
        ? "center"
        : hasRight
          ? "end"
          : "start",
    constraintVertical: hasTop && hasBottom
      ? "stretch"
      : verticallyCentered
        ? "center"
        : hasBottom
          ? "end"
          : "start",
    constraintBaseWidth: round(parentRect.width),
    constraintBaseHeight: round(parentRect.height),
    constraintLeft: round(left),
    constraintRight: round(right),
    constraintTop: round(top),
    constraintBottom: round(bottom),
  };
}

function flexLayoutProperties(element, style, ownerWindow) {
  if (!["flex", "inline-flex"].includes(style.display)) return null;
  const layout = flexAxis(style.flexDirection);
  const justifyContent = flexJustification(style.justifyContent);
  const alignItems = flexAlignment(style.alignItems);
  if (
    !layout ||
    !justifyContent ||
    !alignItems ||
    !["nowrap", "wrap", "none"].includes(style.flexWrap)
  ) {
    return null;
  }

  const childStyles = visibleElementChildren(element, ownerWindow).map((child) =>
    ownerWindow.getComputedStyle(child),
  );
  if (
    childStyles.some(
      (childStyle) =>
        childStyle.float !== "none" ||
        (childStyle.alignSelf !== "auto" && flexAlignment(childStyle.alignSelf) === null),
    )
  ) {
    return null;
  }

  const positiveGrowValues = childStyles
    .map((childStyle) => Number.parseFloat(childStyle.flexGrow || "0"))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (
    positiveGrowValues.length > 1 &&
    positiveGrowValues.some((value) => Math.abs(value - positiveGrowValues[0]) > 0.001)
  ) {
    // v3 stores grow as a boolean. Unequal CSS grow factors need measured-coordinate fallback.
    return null;
  }

  const rowGap = Math.max(0, pixelValue(style.rowGap));
  const columnGap = Math.max(0, pixelValue(style.columnGap));
  const inset = layoutInsets(style);
  return {
    layout,
    gap: round(layout === "horizontal" ? columnGap : rowGap),
    rowGap: round(rowGap),
    columnGap: round(columnGap),
    layoutWrap: style.flexWrap === "wrap" ? "wrap" : "none",
    padding: 0,
    paddingTop: round(inset.top),
    paddingRight: round(inset.right),
    paddingBottom: round(inset.bottom),
    paddingLeft: round(inset.left),
    alignItems,
    justifyContent,
    alignContent: contentAlignment(style.alignContent) ?? "start",
  };
}

function splitCssTrackList(value) {
  const tracks = [];
  let token = "";
  let depth = 0;
  for (const character of String(value ?? "").trim()) {
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    if (/\s/u.test(character) && depth === 0) {
      if (token) tracks.push(token);
      token = "";
    } else {
      token += character;
    }
  }
  if (token) tracks.push(token);
  return tracks;
}

function gridLayoutProperties(style) {
  if (!["grid", "inline-grid"].includes(style.display)) return null;
  const tracks = splitCssTrackList(style.gridTemplateColumns);
  if (
    tracks.length === 0 ||
    tracks.some((track) => ["none", "subgrid", "masonry"].includes(track))
  ) {
    return null;
  }
  const alignItems = flexAlignment(style.alignItems);
  const justifyContent = flexJustification(style.justifyContent);
  if (!alignItems || !justifyContent) return null;
  const rowGap = Math.max(0, pixelValue(style.rowGap));
  const columnGap = Math.max(0, pixelValue(style.columnGap));
  const inset = layoutInsets(style);
  return {
    layout: "grid",
    gridColumns: Math.min(24, tracks.length),
    gap: round(columnGap),
    rowGap: round(rowGap),
    columnGap: round(columnGap),
    padding: 0,
    paddingTop: round(inset.top),
    paddingRight: round(inset.right),
    paddingBottom: round(inset.bottom),
    paddingLeft: round(inset.left),
    alignItems,
    justifyContent,
    alignContent: contentAlignment(style.alignContent) ?? "start",
  };
}

function layoutProperties(element, style, ownerWindow) {
  return (
    flexLayoutProperties(element, style, ownerWindow) ??
    gridLayoutProperties(style)
  );
}

function gridSpan(start, end) {
  const explicitSpan = [start, end]
    .map((value) => String(value ?? "").match(/^span\s+(\d+)$/u))
    .find(Boolean);
  if (explicitSpan) return clamp(Number(explicitSpan[1]), 1, 24);
  const startLine = Number.parseInt(start, 10);
  const endLine = Number.parseInt(end, 10);
  return Number.isInteger(startLine) && Number.isInteger(endLine) && endLine > startLine
    ? clamp(endLine - startLine, 1, 24)
    : 1;
}

function layoutItemProperties(element, style, parentLayout) {
  const grow = Number.parseFloat(style.flexGrow || "0");
  const flexBasis = typedCssValue(element, "flex-basis").trim().toLowerCase();
  const hasFixedFlexBasis = Boolean(
    flexBasis &&
      flexBasis !== "auto" &&
      flexBasis !== "content" &&
      flexBasis !== "max-content" &&
      flexBasis !== "min-content",
  );
  const alignment = style.alignSelf === "auto" ? "auto" : flexAlignment(style.alignSelf);
  const absolute = ["absolute", "fixed"].includes(style.position);
  const properties = {
    layoutSizingHorizontal: "fixed",
    layoutSizingVertical: "fixed",
    ...(absolute ? { layoutPositioning: "absolute" } : {}),
    ...(alignment ? { layoutAlignSelf: alignment } : {}),
  };
  if (absolute) return { ...properties, ...absoluteConstraintProperties(element) };
  const autoMarginBefore =
    parentLayout.layout === "horizontal"
      ? typedCssValue(element, "margin-left").trim().toLowerCase() === "auto"
      : parentLayout.layout === "vertical"
        ? typedCssValue(element, "margin-top").trim().toLowerCase() === "auto"
        : false;
  if (autoMarginBefore) properties.layoutMarginBefore = "auto";
  if (parentLayout.layout === "horizontal") {
    if (Number.isFinite(grow) && grow > 0) properties.layoutSizingHorizontal = "fill";
    if (
      alignment === "stretch" ||
      (alignment === "auto" && parentLayout.alignItems === "stretch")
    ) {
      properties.layoutSizingVertical = "fill";
    }
  } else if (parentLayout.layout === "vertical") {
    if (Number.isFinite(grow) && grow > 0) properties.layoutSizingVertical = "fill";
    if (
      alignment === "stretch" ||
      (alignment === "auto" && parentLayout.alignItems === "stretch")
    ) {
      properties.layoutSizingHorizontal = "fill";
    }
  } else if (parentLayout.layout === "grid") {
    const justifySelf =
      style.justifySelf === "auto" ? parentLayout.alignItems : flexAlignment(style.justifySelf);
    const alignSelf =
      style.alignSelf === "auto" ? parentLayout.alignItems : flexAlignment(style.alignSelf);
    if (justifySelf === "stretch") properties.layoutSizingHorizontal = "fill";
    if (alignSelf === "stretch") properties.layoutSizingVertical = "fill";
    properties.gridColumnSpan = gridSpan(style.gridColumnStart, style.gridColumnEnd);
    properties.gridRowSpan = gridSpan(style.gridRowStart, style.gridRowEnd);
  }
  if (
    properties.layoutSizingHorizontal === "fixed" &&
    !(parentLayout.layout === "horizontal" && hasFixedFlexBasis) &&
    cssSizeMode(element, "width") === "hug"
  ) {
    properties.layoutSizingHorizontal = "hug";
  } else if (cssSizeMode(element, "width") === "fill") {
    properties.layoutSizingHorizontal = "fill";
  }
  if (
    properties.layoutSizingVertical === "fixed" &&
    !(parentLayout.layout === "vertical" && hasFixedFlexBasis) &&
    cssSizeMode(element, "height") === "hug"
  ) {
    properties.layoutSizingVertical = "hug";
  } else if (cssSizeMode(element, "height") === "fill") {
    properties.layoutSizingVertical = "fill";
  }
  return properties;
}

function elementNeedsFrame(element, style, forceFrame = false) {
  const fill = parseCssColor(style.backgroundColor);
  const opacity = Number.parseFloat(style.opacity || "1");
  return (
    forceFrame ||
    ["flex", "inline-flex", "grid", "inline-grid"].includes(style.display) ||
    Number.parseFloat(style.flexGrow || "0") > 0 ||
    style.alignSelf !== "auto" ||
    element.hasAttribute("data-codeshell-id") ||
    element.hasAttribute("data-codeshell-name") ||
    (fill && fill.alpha > 0) ||
    borderSides(style).length > 0 ||
    parseCssBoxShadow(style.boxShadow) !== null ||
    ["hidden", "clip"].includes(style.overflowX) ||
    ["hidden", "clip"].includes(style.overflowY) ||
    opacity < 0.999
  );
}

function appendSurfaceLayers(frame, style, rect, nextId) {
  const fill = parseCssColor(style.backgroundColor);
  const radius = representativeCornerRadius(style);
  const shadow = parseCssBoxShadow(style.boxShadow);
  let hasManualLayers = false;
  if (fill?.alpha === 1) {
    frame.fill = fill.hex;
    if (shadow) {
      frame.shadow = shadow;
      frame.effectClipping = "intentional";
    }
  } else if ((fill && fill.alpha > 0) || shadow) {
    hasManualLayers = true;
    frame.children.push(
      rectangleNode(nextId("surface"), `${frame.name} surface`, rect, {
        fill: fill?.alpha > 0 ? fill.hex : "transparent",
        opacity: fill?.alpha > 0 ? round(fill.alpha, 4) : 1,
        cornerRadius: radius,
        layoutPositioning: "absolute",
        constraintHorizontal: "stretch",
        constraintVertical: "stretch",
        constraintBaseWidth: round(rect.width),
        constraintBaseHeight: round(rect.height),
        constraintLeft: 0,
        constraintRight: 0,
        constraintTop: 0,
        constraintBottom: 0,
        ...(shadow ? { shadow, effectClipping: "intentional" } : {}),
      }),
    );
  }

  const borders = borderSides(style);
  const uniform =
    (borders.length === 4 || (radius > 0 && borders.length >= 3)) &&
    borders.every(
      (border) =>
        Math.abs(border.width - borders[0].width) < 0.1 &&
        border.color.hex === borders[0].color.hex &&
        Math.abs(border.color.alpha - borders[0].color.alpha) < 0.001,
    );
  if (uniform) {
    const border = borders[0];
    frame.children.push(
      rectangleNode(
        nextId("border"),
        `${frame.name} border`,
        {
          x: round(rect.x + border.width / 2),
          y: round(rect.y + border.width / 2),
          width: round(Math.max(1, rect.width - border.width)),
          height: round(Math.max(1, rect.height - border.width)),
        },
        {
          stroke: border.color.hex,
          strokeWidth: round(border.width),
          opacity: round(border.color.alpha, 4),
          cornerRadius: round(Math.max(0, radius - border.width / 2)),
          layoutPositioning: "absolute",
          constraintHorizontal: "stretch",
          constraintVertical: "stretch",
          constraintBaseWidth: round(rect.width),
          constraintBaseHeight: round(rect.height),
          constraintLeft: round(border.width / 2),
          constraintRight: round(border.width / 2),
          constraintTop: round(border.width / 2),
          constraintBottom: round(border.width / 2),
        },
      ),
    );
    // A uniform border is a safe absolute decoration: it does not need to participate in
    // flow and therefore must not downgrade an otherwise editable Flex/Grid container.
    return hasManualLayers;
  }

  for (const border of borders) {
    hasManualLayers = true;
    const borderRect =
      border.side === "top"
        ? { x: rect.x, y: rect.y, width: rect.width, height: border.width }
        : border.side === "bottom"
          ? {
              x: rect.x,
              y: round(rect.y + rect.height - border.width),
              width: rect.width,
              height: border.width,
            }
          : border.side === "left"
            ? { x: rect.x, y: rect.y, width: border.width, height: rect.height }
            : {
                x: round(rect.x + rect.width - border.width),
                y: rect.y,
                width: border.width,
                height: rect.height,
              };
    frame.children.push(
      rectangleNode(
        nextId(`border-${border.side}`),
        `${frame.name} ${border.side} border`,
        borderRect,
        {
          fill: border.color.hex,
          opacity: round(border.color.alpha, 4),
          layoutPositioning: "absolute",
          constraintHorizontal: ["top", "bottom"].includes(border.side)
            ? "stretch"
            : border.side === "right"
              ? "end"
              : "start",
          constraintVertical: ["left", "right"].includes(border.side)
            ? "stretch"
            : border.side === "bottom"
              ? "end"
              : "start",
          constraintBaseWidth: round(rect.width),
          constraintBaseHeight: round(rect.height),
          constraintLeft: round(borderRect.x - rect.x),
          constraintRight: round(rect.x + rect.width - borderRect.x - borderRect.width),
          constraintTop: round(borderRect.y - rect.y),
          constraintBottom: round(rect.y + rect.height - borderRect.y - borderRect.height),
        },
      ),
    );
  }
  return hasManualLayers;
}

function svgShapeNode(element, style, rect, nextId) {
  if (
    element.namespaceURI !== SVG_NS ||
    !["rect", "circle", "ellipse"].includes(element.localName)
  ) {
    return null;
  }
  const fill = parseCssColor(style.fill) ?? { hex: "#000000", alpha: 0 };
  const stroke = parseCssColor(style.stroke) ?? { hex: "#000000", alpha: 0 };
  const rawFillOpacity = Number.parseFloat(style.fillOpacity || "1");
  const rawOpacity = Number.parseFloat(style.opacity || "1");
  const fillOpacity = clamp(Number.isFinite(rawFillOpacity) ? rawFillOpacity : 1, 0, 1);
  const opacity = clamp(Number.isFinite(rawOpacity) ? rawOpacity : 1, 0, 1);
  const type = ["circle", "ellipse"].includes(element.localName) ? "ellipse" : "rectangle";
  const radius =
    type === "rectangle"
      ? Math.max(
          0,
          pixelValue(element.getAttribute("rx") ?? "0"),
          pixelValue(element.getAttribute("ry") ?? "0"),
        )
      : 0;
  return {
    ...baseNode(
      nextId(element.getAttribute("data-codeshell-id") || element.id || element.localName),
      type,
      element.getAttribute("data-codeshell-name") ||
        element.getAttribute("aria-label") ||
        element.id ||
        element.localName,
      rect,
    ),
    fill: fill.alpha > 0 ? fill.hex : "transparent",
    stroke: stroke.alpha > 0 ? stroke.hex : "transparent",
    strokeWidth: stroke.alpha > 0 ? round(Math.max(0, pixelValue(style.strokeWidth))) : 0,
    opacity: round(
      opacity * (fill.alpha > 0 ? fill.alpha * fillOpacity : (stroke.alpha > 0 ? stroke.alpha : 1)),
      4,
    ),
    cornerRadius: round(radius),
  };
}

function appendTextLayers(frame, node, style, rootRect, nextId, captureBounds = null) {
  const color =
    parseCssColor(node.parentElement?.namespaceURI === SVG_NS ? style.fill : style.color) ??
    { hex: "#000000", alpha: 1 };
  const size = clamp(pixelValue(style.fontSize, 16), 6, 240);
  const lineHeightPixels =
    style.lineHeight === "normal" ? size * 1.2 : pixelValue(style.lineHeight, size * 1.2);
  const spacing = style.letterSpacing === "normal" ? 0 : pixelValue(style.letterSpacing);
  const baselineOffset = hangingBaselineOffset(style, size, spacing, node.ownerDocument);
  const lines = textLineRects(node, rootRect, captureBounds);
  const rawText = transformedText(
    String(node.textContent ?? "")
      .replace(/\s+/gu, " ")
      .trim(),
    style.textTransform,
  );
  const hasInlineElementSibling = [...(node.parentElement?.children ?? [])].some((child) =>
    ["inline", "inline-block", "inline-flex", "inline-grid"].includes(
      node.ownerDocument.defaultView.getComputedStyle(child).display,
    ),
  );
  const adaptive =
    rawText &&
    lines.length > 0 &&
    !["nowrap", "pre"].includes(style.whiteSpace) &&
    !hasInlineElementSibling &&
    lines.every((line) => Math.abs(line.rect.x - lines[0].rect.x) < 1);
  const commonProperties = {
    fill: color.hex,
    opacity: round(color.alpha, 4),
    fontSize: round(size),
    fontWeight: fontWeight(style.fontWeight),
    fontFamily: String(style.fontFamily || "Arial, sans-serif").slice(0, 120),
    fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
    lineHeight: round(clamp(lineHeightPixels / size, 0.7, 3), 4),
    letterSpacing: round(clamp(spacing, -20, 100)),
    textDecoration: textDecoration(style.textDecorationLine || style.textDecoration),
    textAlign: "left",
    textMeasurement: "browser",
    layoutBaselineOffset: round(baselineOffset, 4),
  };
  const ellipsis =
    rawText &&
    lines.length > 0 &&
    style.textOverflow === "ellipsis" &&
    ["hidden", "clip"].includes(style.overflowX) &&
    ["nowrap", "pre"].includes(style.whiteSpace);
  if (ellipsis) {
    const parentRect = node.parentElement.getBoundingClientRect();
    const inset = layoutInsets(style);
    const lineLeft = rootRect.left + lines[0].rect.x;
    const flowWidth = Math.max(1, parentRect.right - inset.right - lineLeft);
    frame.children.push({
      ...baseNode(nextId("text-ellipsis"), "text", `${frame.name} text`, {
        x: lines[0].rect.x,
        y: round(lines[0].rect.y + baselineOffset),
        width: round(flowWidth),
        height: round(Math.max(lines[0].rect.height, lineHeightPixels)),
      }),
      ...commonProperties,
      text: ellipsizedText(node.ownerDocument, style, rawText, flowWidth),
      textSource: rawText,
      textOverflow: "ellipsis",
      textFlowWidth: round(flowWidth),
    });
    return;
  }
  if (adaptive) {
    const parentRect = node.parentElement.getBoundingClientRect();
    const inset = layoutInsets(style);
    const lineLeft = rootRect.left + lines[0].rect.x;
    const flowWidth = Math.max(1, parentRect.right - inset.right - lineLeft);
    frame.children.push({
      ...baseNode(nextId("text-flow"), "text", `${frame.name} text`, {
        x: lines[0].rect.x,
        y: round(lines[0].rect.y + baselineOffset),
        width: round(Math.max(...lines.map((line) => line.rect.width))),
        height: round(
          Math.max(
            1,
            lines.at(-1).rect.y + lines.at(-1).rect.height - lines[0].rect.y,
          ),
        ),
      }),
      ...commonProperties,
      text: lines.map((line) => transformedText(line.text, style.textTransform)).join("\n"),
      textSource: rawText,
      textFlow: "wrap",
      textFlowWidth: round(flowWidth),
    });
    return;
  }
  for (const [index, line] of lines.entries()) {
    frame.children.push({
      ...baseNode(nextId(`text-${index + 1}`), "text", `${frame.name} text`, {
        ...line.rect,
        // Design SVG text uses dominant-baseline="hanging", whose anchor sits
        // below the browser Range box top. Measure the active font rather than
        // relying on a font-specific baseline constant.
        y: round(line.rect.y + baselineOffset),
        height: round(Math.max(line.rect.height, lineHeightPixels)),
      }),
      ...commonProperties,
      text: transformedText(line.text, style.textTransform),
    });
  }
}

function formControlValue(element) {
  const tag = element.tagName.toLowerCase();
  if (tag === "textarea") return element.value || element.placeholder || "";
  if (tag === "select") return element.selectedOptions?.[0]?.textContent?.trim() ?? "";
  if (tag !== "input") return "";
  const type = String(element.type || "text").toLowerCase();
  if (
    [
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ].includes(type)
  ) {
    return "";
  }
  return element.value || element.placeholder || "";
}

function measuredStyledTextWidth(ownerDocument, style, value) {
  const canvas = ownerDocument.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return Math.max(1, value.length * pixelValue(style.fontSize, 16) * 0.56);
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const spacing = style.letterSpacing === "normal" ? 0 : pixelValue(style.letterSpacing);
  return Math.max(1, context.measureText(value).width + Math.max(0, value.length - 1) * spacing);
}

function ellipsizedText(ownerDocument, style, value, available) {
  if (measuredStyledTextWidth(ownerDocument, style, value) <= available) return value;
  const characters = [...value];
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (
      measuredStyledTextWidth(ownerDocument, style, `${characters.slice(0, middle).join("")}…`) <=
      available
    ) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return `${characters.slice(0, low).join("").trimEnd()}…`;
}

function measuredControlTextWidth(element, style, value) {
  return measuredStyledTextWidth(element.ownerDocument, style, value);
}

function appendFormControlTextLayer(frame, element, style, rect, nextId) {
  const value = formControlValue(element).replace(/\s+/gu, " ").trim();
  if (!value) return;
  const color = parseCssColor(style.color) ?? { hex: "#000000", alpha: 1 };
  const size = clamp(pixelValue(style.fontSize, 16), 6, 240);
  const lineHeightPixels =
    style.lineHeight === "normal" ? size * 1.2 : pixelValue(style.lineHeight, size * 1.2);
  const spacing = style.letterSpacing === "normal" ? 0 : pixelValue(style.letterSpacing);
  const borderLeft = Math.max(0, pixelValue(style.borderLeftWidth));
  const borderTop = Math.max(0, pixelValue(style.borderTopWidth));
  const paddingLeft = Math.max(0, pixelValue(style.paddingLeft));
  const paddingTop = Math.max(0, pixelValue(style.paddingTop));
  const multiline = element.tagName.toLowerCase() === "textarea";
  const lineTop = multiline
    ? rect.y + borderTop + paddingTop
    : rect.y + Math.max(0, (rect.height - lineHeightPixels) / 2);
  const baselineOffset = hangingBaselineOffset(
    style,
    size,
    spacing,
    element.ownerDocument,
  );
  frame.children.push({
    ...baseNode(nextId("control-value"), "text", `${frame.name} value`, {
      x: round(rect.x + borderLeft + paddingLeft),
      y: round(lineTop + baselineOffset),
      width: round(
        Math.min(
          measuredControlTextWidth(element, style, value),
          Math.max(1, rect.width - borderLeft * 2 - paddingLeft * 2),
        ),
      ),
      height: round(lineHeightPixels),
    }),
    fill: color.hex,
    opacity: round(color.alpha, 4),
    text: transformedText(value, style.textTransform),
    fontSize: round(size),
    fontWeight: fontWeight(style.fontWeight),
    fontFamily: String(style.fontFamily || "Arial, sans-serif").slice(0, 120),
    fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
    lineHeight: round(clamp(lineHeightPixels / size, 0.7, 3), 4),
    letterSpacing: round(clamp(spacing, -20, 100)),
    textDecoration: textDecoration(style.textDecorationLine || style.textDecoration),
    textAlign: "left",
    textMeasurement: "browser",
    layoutBaselineOffset: round(baselineOffset, 4),
  });
}

function promoteMeasuredBlockLayout(holder, style, hasManualLayers) {
  if (
    holder.layout !== "none" ||
    hasManualLayers ||
    !["block", "flow-root", "list-item"].includes(style.display)
  ) {
    return;
  }
  const children = holder.children.filter(
    (child) => child.visible !== false && child.layoutPositioning !== "absolute",
  );
  const absoluteDecorations = holder.children.filter(
    (child) => child.visible !== false && child.layoutPositioning === "absolute",
  );
  if (
    children.length === 0 ||
    absoluteDecorations.some(
      (child) => child.type !== "rectangle" || !/\bborder\b/u.test(child.name),
    )
  ) {
    return;
  }
  const inset = layoutInsets(style);
  const contentWidth = Math.max(1, holder.width - inset.left - inset.right);
  if (
    children.some(
      (child) => child.type !== "text" && child.width < contentWidth - 1,
    )
  ) {
    return;
  }
  const top = (child) => child.y - (child.type === "text" ? finiteBaseline(child) : 0);
  const gaps = [];
  for (let index = 1; index < children.length; index += 1) {
    const previous = children[index - 1];
    const gap = top(children[index]) - (top(previous) + previous.height);
    if (gap < -1) return;
    gaps.push(Math.max(0, gap));
  }
  if (
    gaps.length > 1 &&
    gaps.some((gap) => Math.abs(gap - gaps[0]) > 2)
  ) {
    return;
  }
  holder.layout = "vertical";
  holder.layoutWrap = "none";
  holder.gap = round(gaps[0] ?? 0);
  holder.rowGap = holder.gap;
  holder.columnGap = 0;
  holder.padding = 0;
  holder.paddingTop = round(inset.top);
  holder.paddingRight = round(inset.right);
  holder.paddingBottom = round(inset.bottom);
  holder.paddingLeft = round(inset.left);
  holder.alignItems = "stretch";
  holder.justifyContent = "start";
  holder.alignContent = "start";
  for (const child of children) {
    child.layoutSizingHorizontal = child.textFlow === "wrap" ? "fill" : "hug";
    child.layoutSizingVertical = "hug";
  }
}

function finiteBaseline(node) {
  return Number.isFinite(node?.layoutBaselineOffset) ? node.layoutBaselineOffset : 0;
}

export async function captureHtmlToDesign(root, options = {}) {
  if (
    !root ||
    root.nodeType !== ELEMENT_NODE ||
    typeof root.getBoundingClientRect !== "function" ||
    !root.ownerDocument?.defaultView
  ) {
    throw new Error("captureHtmlToDesign root must be an Element");
  }
  const ownerDocument = root.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  if (ownerDocument.fonts?.ready) await ownerDocument.fonts.ready;
  const measuredRootRect = root.getBoundingClientRect();
  if (measuredRootRect.width < 1 || measuredRootRect.height < 1) {
    throw new Error("captureHtmlToDesign root must have rendered geometry");
  }
  const requestedCaptureBounds = normalizedCaptureBounds(options.captureBounds);
  const rootRect = requestedCaptureBounds
    ? intersectRects(measuredRootRect, requestedCaptureBounds)
    : measuredRootRect;
  if (!rootRect) {
    throw new Error("captureHtmlToDesign root does not intersect captureBounds");
  }
  let sequence = 0;
  const nextId = (hint) => `${semanticSlug(hint)}-${++sequence}`;

  const captureElement = (
    element,
    fallbackName = element.tagName.toLowerCase(),
    forceFrame = false,
    parentLayout = null,
  ) => {
    const style = ownerWindow.getComputedStyle(element);
    const browserRect = element.getBoundingClientRect();
    if (!isVisibleElement(element, style, browserRect)) return [];
    if (requestedCaptureBounds && !intersectRects(browserRect, rootRect)) return [];
    const rect = relativeRect(
      requestedCaptureBounds && element === root ? rootRect : browserRect,
      rootRect,
    );
    const svgShape = svgShapeNode(element, style, rect, nextId);
    if (svgShape) return [svgShape];
    const name =
      element.getAttribute("data-codeshell-name") ||
      element.getAttribute("aria-label") ||
      element.id ||
      element.classList[0] ||
      fallbackName;
    const intrinsicNeedsFrame = elementNeedsFrame(element, style, forceFrame);
    const needsFrame = intrinsicNeedsFrame || Boolean(parentLayout);
    const transparentLayoutWrapper = needsFrame && !intrinsicNeedsFrame && Boolean(parentLayout);
    const ownLayout = layoutProperties(element, style, ownerWindow);
    const measuredInsets = layoutInsets(style);
    const clipsContent =
      ["hidden", "clip"].includes(style.overflowX) ||
      ["hidden", "clip"].includes(style.overflowY) ||
      Boolean(requestedCaptureBounds && element === root);
    const holder = needsFrame
      ? frameNode(nextId(element.getAttribute("data-codeshell-id") || name), name, rect, {
          opacity: round(clamp(Number.parseFloat(style.opacity || "1"), 0, 1), 4),
          cornerRadius: representativeCornerRadius(style),
          padding: 0,
          paddingTop: round(measuredInsets.top),
          paddingRight: round(measuredInsets.right),
          paddingBottom: round(measuredInsets.bottom),
          paddingLeft: round(measuredInsets.left),
          ...(ownLayout ?? {}),
          ...(parentLayout ? layoutItemProperties(element, style, parentLayout) : {}),
          clipContent: clipsContent,
          ...(clipsContent ? { contentClipping: "intentional" } : {}),
        })
      : { name, children: [] };
    const hasManualLayers = needsFrame
      ? appendSurfaceLayers(holder, style, rect, nextId)
      : false;
    if (hasManualLayers && holder.layout !== "none") {
      // Multiple paint layers still fall back conservatively: they are represented as
      // absolute children, but preserving the measured DOM child grouping is more faithful
      // than promoting decoration-heavy controls to editable flow in this capture pass.
      holder.layout = "none";
    }
    const ownsLayout = needsFrame && holder.layout !== "none";

    for (const child of element.childNodes) {
      if (child.nodeType === TEXT_NODE) {
        appendTextLayers(
          holder,
          child,
          style,
          rootRect,
          nextId,
          requestedCaptureBounds ? rootRect : null,
        );
      } else if (child.nodeType === ELEMENT_NODE) {
        holder.children.push(
          ...captureElement(
            child,
            child.tagName.toLowerCase(),
            false,
            ownsLayout && !hasManualLayers ? ownLayout : null,
          ),
        );
      }
    }
    appendFormControlTextLayer(holder, element, style, rect, nextId);
    if (
      transparentLayoutWrapper &&
      holder.children.length > 0 &&
      holder.children.every((child) => child.type === "text")
    ) {
      const sameLine =
        holder.children.length > 1 &&
        holder.children.every(
          (child) =>
            Math.abs(
              child.y -
                finiteBaseline(child) -
                (holder.children[0].y - finiteBaseline(holder.children[0])),
            ) < 1.5,
        );
      holder.layout = sameLine ? "horizontal" : "vertical";
      holder.layoutWrap = "none";
      const measuredGap =
        holder.children.length > 1
          ? sameLine
            ? Math.max(
                0,
                holder.children[1].x -
                  (holder.children[0].x + holder.children[0].width),
              )
            : Math.max(
                0,
                holder.children[1].y -
                  finiteBaseline(holder.children[1]) -
                  (holder.children[0].y -
                    finiteBaseline(holder.children[0]) +
                    holder.children[0].height),
              )
          : 0;
      holder.gap = round(measuredGap);
      holder.rowGap = sameLine ? 0 : holder.gap;
      holder.columnGap = sameLine ? holder.gap : 0;
      holder.padding = 0;
      holder.paddingTop = 0;
      holder.paddingRight = 0;
      holder.paddingBottom = 0;
      holder.paddingLeft = 0;
      holder.alignItems = "stretch";
      holder.justifyContent = "start";
      holder.alignContent = "start";
      for (const child of holder.children) {
        child.layoutSizingHorizontal =
          !sameLine && child.textFlow === "wrap" ? "fill" : "hug";
        child.layoutSizingVertical = "hug";
      }
    }
    promoteMeasuredBlockLayout(holder, style, hasManualLayers);
    return needsFrame ? [holder] : holder.children;
  };

  const rootStyle = ownerWindow.getComputedStyle(root);
  const rootFill = parseCssColor(rootStyle.backgroundColor);
  const [capturedRoot] = captureElement(root, options.name ?? "HTML capture", true);
  if (!capturedRoot) throw new Error("captureHtmlToDesign root is not visible");
  capturedRoot.x = 0;
  capturedRoot.y = 0;
  if (requestedCaptureBounds) {
    capturedRoot.clipContent = true;
    capturedRoot.contentClipping = "intentional";
  }
  return {
    format: "codeshell.design",
    version: 3,
    name: options.name ?? "HTML capture",
    canvas: {
      width: round(rootRect.width),
      height: round(rootRect.height),
      background: rootFill?.alpha > 0 ? rootFill.hex : (options.background ?? "#ffffff"),
    },
    tokens: { colors: [] },
    activePageId: "page-1",
    pages: [
      {
        id: "page-1",
        name: "HTML capture",
        children: [capturedRoot],
      },
    ],
  };
}
