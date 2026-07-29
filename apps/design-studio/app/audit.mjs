/* Accessibility and layout audit engine for the Design Studio Panel App. */
import {
  pointFromNodeSpace,
  pointToNodeSpace,
  transformedNodeBounds,
  transformedNodeBoundsInTree,
} from "./geometry.mjs";
import {
  effectiveDesignNodeOpacity,
  isDesignNodeVisible,
  renderedDesignInstanceEffectOutsets,
} from "./document.mjs";

function validHex(value) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function rgb(value) {
  return [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
}

function channelLuminance(channel) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(foreground, background) {
  if (!validHex(foreground) || !validHex(background)) return null;
  const luminance = (value) => {
    const [red, green, blue] = rgb(value).map(channelLuminance);
    return red * 0.2126 + green * 0.7152 + blue * 0.0722;
  };
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

function blendHex(foreground, background, opacity) {
  if (!validHex(foreground) || !validHex(background)) return background;
  const alpha = Math.min(1, Math.max(0, opacity));
  const blended = rgb(foreground).map((channel, index) => {
    const backgroundChannel = rgb(background)[index];
    return Math.round((channel * alpha + backgroundChannel * (1 - alpha)) * 255);
  });
  return `#${blended.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function glyphWidthFactor(character) {
  if (/\s/u.test(character)) return 0.33;
  if (/[ilI1.,:;'|!•·…]/u.test(character)) return 0.28;
  if (/[mwMW@#%&]/u.test(character)) return 0.9;
  if (/[\u0000-\u00ff]/u.test(character)) return 0.56;
  return 1;
}

export function estimateTextLineWidth(node, line) {
  const characters = Array.from(String(line));
  const glyphWidth = characters.reduce(
    (width, character) => width + glyphWidthFactor(character) * node.fontSize,
    0,
  );
  return glyphWidth + Math.max(0, characters.length - 1) * (node.letterSpacing ?? 0);
}

function contains(container, node) {
  const epsilon = 0.5;
  return (
    node.x >= container.x - epsilon &&
    node.y >= container.y - epsilon &&
    node.x + node.width <= container.x + container.width + epsilon &&
    node.y + node.height <= container.y + container.height + epsilon
  );
}

function isIntentionalClippedEdgeSurface(node, ancestor) {
  const radius =
    ancestor.type === "ellipse"
      ? Math.min(ancestor.width, ancestor.height) / 2
      : Math.min(ancestor.cornerRadius ?? 0, ancestor.width / 2, ancestor.height / 2);
  const touchesEdge =
    Math.abs(node.x - ancestor.x) <= 0.5 ||
    Math.abs(node.y - ancestor.y) <= 0.5 ||
    Math.abs(node.x + node.width - (ancestor.x + ancestor.width)) <= 0.5 ||
    Math.abs(node.y + node.height - (ancestor.y + ancestor.height)) <= 0.5;
  const intentionalEdgeSurface =
    radius > 0 &&
    validHex(node.fill) &&
    ["frame", "rectangle", "component"].includes(node.type) &&
    (node.rotation ?? 0) === 0 &&
    touchesEdge &&
    Math.max(node.width, node.height) + 0.5 >= radius * 2;
  return intentionalEdgeSurface;
}

function exceedsClippingAncestor(nodes, node, ancestor, nodeIndex) {
  const outline = nodeOutlinePointsInTree(nodes, node, nodeIndex);
  if (!outline) return true;
  if (pointsExceedNode(nodes, outline, ancestor, nodeIndex)) return true;
  const exceedsRoundedShape = outline.some(
    (point) => !pointInNodeShape(nodes, ancestor, point, nodeIndex, 0.5),
  );
  return exceedsRoundedShape && !isIntentionalClippedEdgeSurface(node, ancestor);
}

function pointsExceedNode(nodes, points, node, nodeIndex) {
  const epsilon = 0.5;
  return points.some((point) => {
    const local = pointToNodeSpace(nodes, node, point, nodeIndex);
    return (
      !local ||
      local.x < node.x - epsilon ||
      local.y < node.y - epsilon ||
      local.x > node.x + node.width + epsilon ||
      local.y > node.y + node.height + epsilon
    );
  });
}

function nodeOutlinePointsInTree(nodes, node, nodeIndex) {
  if (
    !node ||
    ![node.x, node.y, node.width, node.height, node.rotation ?? 0].every(Number.isFinite)
  ) {
    return null;
  }
  const points = [];
  if (node.type === "ellipse") {
    const centerX = node.x + node.width / 2;
    const centerY = node.y + node.height / 2;
    for (let index = 0; index < 32; index += 1) {
      const angle = (index / 32) * Math.PI * 2;
      points.push({
        x: centerX + Math.cos(angle) * (node.width / 2),
        y: centerY + Math.sin(angle) * (node.height / 2),
      });
    }
  } else if (node.type === "text") {
    const lines = String(node.text).split("\n");
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const width =
        node.textMeasurement === "browser"
          ? node.width
          : Math.min(node.width, Math.max(1, estimateTextLineWidth(node, lines[lineIndex])));
      const left =
        node.textAlign === "center"
          ? node.x + (node.width - width) / 2
          : node.textAlign === "right"
            ? node.x + node.width - width
            : node.x;
      const top = node.y + lineIndex * node.fontSize * node.lineHeight;
      const bottom = Math.min(node.y + node.height, top + node.fontSize);
      points.push(
        { x: left, y: top },
        { x: left + width, y: top },
        { x: left + width, y: bottom },
        { x: left, y: bottom },
      );
    }
  } else {
    const radius = Math.min(node.cornerRadius ?? 0, node.width / 2, node.height / 2);
    if (radius <= 0 || ["group", "instance"].includes(node.type)) {
      points.push(
        { x: node.x, y: node.y },
        { x: node.x + node.width, y: node.y },
        { x: node.x + node.width, y: node.y + node.height },
        { x: node.x, y: node.y + node.height },
      );
    } else {
      const corners = [
        { x: node.x + radius, y: node.y + radius, start: Math.PI },
        { x: node.x + node.width - radius, y: node.y + radius, start: -Math.PI / 2 },
        {
          x: node.x + node.width - radius,
          y: node.y + node.height - radius,
          start: 0,
        },
        { x: node.x + radius, y: node.y + node.height - radius, start: Math.PI / 2 },
      ];
      for (const corner of corners) {
        for (let index = 0; index <= 8; index += 1) {
          const angle = corner.start + (index / 8) * (Math.PI / 2);
          points.push({
            x: corner.x + Math.cos(angle) * radius,
            y: corner.y + Math.sin(angle) * radius,
          });
        }
      }
    }
  }
  return points.map((point) => pointFromNodeSpace(nodes, node, point, nodeIndex)).filter(Boolean);
}

function nodeEffectCornersInTree(document, node, nodeIndex) {
  const shadow = node.shadow?.opacity > 0 ? node.shadow : null;
  const shadowOutset = shadow?.blur * 1.5 || 0;
  const strokeOutset =
    !["group", "instance"].includes(node.type) && validHex(node.stroke) && node.strokeWidth > 0
      ? node.strokeWidth / 2
      : 0;
  const instanceOutsets =
    node.type === "instance"
      ? renderedDesignInstanceEffectOutsets(document, node)
      : { left: 0, top: 0, right: 0, bottom: 0 };
  const leftOutset = Math.max(
    instanceOutsets.left,
    strokeOutset,
    shadow ? strokeOutset + shadowOutset + Math.max(0, -shadow.x) : 0,
  );
  const topOutset = Math.max(
    instanceOutsets.top,
    strokeOutset,
    shadow ? strokeOutset + shadowOutset + Math.max(0, -shadow.y) : 0,
  );
  const rightOutset = Math.max(
    instanceOutsets.right,
    strokeOutset,
    shadow ? strokeOutset + shadowOutset + Math.max(0, shadow.x) : 0,
  );
  const bottomOutset = Math.max(
    instanceOutsets.bottom,
    strokeOutset,
    shadow ? strokeOutset + shadowOutset + Math.max(0, shadow.y) : 0,
  );
  if (Math.max(leftOutset, topOutset, rightOutset, bottomOutset) <= 0) return null;
  const left = node.x - leftOutset;
  const top = node.y - topOutset;
  const right = node.x + node.width + rightOutset;
  const bottom = node.y + node.height + bottomOutset;
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ]
    .map((point) => pointFromNodeSpace(document.nodes, node, point, nodeIndex))
    .filter(Boolean);
}

function boundsForPoints(points) {
  if (!points || points.length === 0) return null;
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const right = Math.max(...points.map((point) => point.x));
  const bottom = Math.max(...points.map((point) => point.y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function pointInNodeShape(nodes, node, point, nodeIndex, epsilon = 0) {
  const local = pointToNodeSpace(nodes, node, point, nodeIndex);
  if (
    !local ||
    local.x < node.x - epsilon ||
    local.x > node.x + node.width + epsilon ||
    local.y < node.y - epsilon ||
    local.y > node.y + node.height + epsilon
  ) {
    return false;
  }
  if (node.type !== "ellipse") {
    const radius = Math.min(node.cornerRadius ?? 0, node.width / 2, node.height / 2);
    if (radius <= 0) return true;
    const insetLeft = node.x + radius;
    const insetRight = node.x + node.width - radius;
    const insetTop = node.y + radius;
    const insetBottom = node.y + node.height - radius;
    if (
      (local.x >= insetLeft && local.x <= insetRight) ||
      (local.y >= insetTop && local.y <= insetBottom)
    ) {
      return true;
    }
    const cornerX = local.x < insetLeft ? insetLeft : insetRight;
    const cornerY = local.y < insetTop ? insetTop : insetBottom;
    return (local.x - cornerX) ** 2 + (local.y - cornerY) ** 2 <= (radius + epsilon) ** 2;
  }
  const radiusX = node.width / 2;
  const radiusY = node.height / 2;
  if (radiusX <= 0 || radiusY <= 0) return false;
  const center = { x: node.x + radiusX, y: node.y + radiusY };
  return (
    ((local.x - center.x) / (radiusX + epsilon)) ** 2 +
      ((local.y - center.y) / (radiusY + epsilon)) ** 2 <=
    1
  );
}

function pointInNodeFill(document, node, point, nodeIndex) {
  return pointInNodeShape(document.nodes, node, point, nodeIndex);
}

function fillIsVisibleAtPoint(document, node, point, byId) {
  if (
    node.type === "group" ||
    !validHex(node.fill) ||
    !pointInNodeFill(document, node, point, byId)
  ) {
    return false;
  }
  const seen = new Set();
  let parentId = node.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    if (parent.clipContent === true && !pointInNodeFill(document, parent, point, byId))
      return false;
    parentId = parent.parentId;
  }
  return isDesignNodeVisible(document, node, byId);
}

function textSamplePoints(document, node, lines, nodeIndex) {
  return lines.flatMap((line, lineIndex) => {
    const measuredWidth = Math.min(node.width, Math.max(1, estimateTextLineWidth(node, line)));
    const startX =
      node.textAlign === "center"
        ? node.x + (node.width - measuredWidth) / 2
        : node.textAlign === "right"
          ? node.x + node.width - measuredWidth
          : node.x;
    const localY = Math.min(
      node.y + node.height - 0.5,
      Math.max(
        node.y + 0.5,
        node.y + lineIndex * node.fontSize * node.lineHeight + node.fontSize / 2,
      ),
    );
    return [0.15, 0.5, 0.85]
      .map((fraction) =>
        pointFromNodeSpace(
          document.nodes,
          node,
          {
            x: startX + measuredWidth * fraction,
            y: localY,
          },
          nodeIndex,
        ),
      )
      .filter(Boolean);
  });
}

function rgbaFromHex(value, opacity = 1) {
  const [red, green, blue] = rgb(value);
  return {
    red,
    green,
    blue,
    alpha: Math.min(1, Math.max(0, opacity)),
  };
}

function compositeRgba(foreground, background) {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  if (alpha <= 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
  return {
    red:
      (foreground.red * foreground.alpha +
        background.red * background.alpha * (1 - foreground.alpha)) /
      alpha,
    green:
      (foreground.green * foreground.alpha +
        background.green * background.alpha * (1 - foreground.alpha)) /
      alpha,
    blue:
      (foreground.blue * foreground.alpha +
        background.blue * background.alpha * (1 - foreground.alpha)) /
      alpha,
    alpha,
  };
}

function opaqueHexFromRgba(value) {
  return `#${[value.red, value.green, value.blue]
    .map((channel) =>
      Math.round(Math.min(1, Math.max(0, channel)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function applyGroupOpacity(pixel, opacity, background) {
  return compositeRgba(
    {
      ...pixel,
      alpha: pixel.alpha * Math.min(1, Math.max(0, opacity)),
    },
    background,
  );
}

function allReadableDesignNodes(document) {
  const pages = Array.isArray(document.pages) ? document.pages : [];
  if (pages.length === 0) return document.nodes;
  return pages.flatMap((page) =>
    page.id === document.activePageId ? document.nodes : (page.nodes ?? []),
  );
}

function componentSourceNodes(nodes, component) {
  const descendantIds = new Set();
  const queue = [component.id];
  for (let index = 0; index < queue.length; index += 1) {
    const parentId = queue[index];
    for (const candidate of nodes) {
      if (candidate.parentId !== parentId || descendantIds.has(candidate.id)) continue;
      descendantIds.add(candidate.id);
      queue.push(candidate.id);
    }
  }
  return [component, ...nodes.filter((candidate) => descendantIds.has(candidate.id))];
}

function pointVisibleThroughAncestorClips(document, node, point, nodeIndex) {
  const seen = new Set();
  let parentId = node.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = nodeIndex.get(parentId);
    if (!parent) break;
    if (parent.clipContent === true && !pointInNodeFill(document, parent, point, nodeIndex)) {
      return false;
    }
    parentId = parent.parentId;
  }
  return true;
}

function mapComponentPointToInstance(document, instance, component, point, nodeIndex) {
  const mapped = {
    x: instance.x + ((point.x - component.x) * instance.width) / component.width,
    y: instance.y + ((point.y - component.y) * instance.height) / component.height,
  };
  return pointFromNodeSpace(document.nodes, instance, mapped, nodeIndex);
}

function mapInstancePointToComponent(document, instance, component, point, nodeIndex) {
  const local = pointToNodeSpace(document.nodes, instance, point, nodeIndex);
  if (!local) return null;
  return {
    x: component.x + ((local.x - instance.x) * component.width) / instance.width,
    y: component.y + ((local.y - instance.y) * component.height) / instance.height,
  };
}

function detachedComponentDocument(document, componentId) {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (node.id !== componentId || !node.parentId) return node;
      const { parentId: _parentId, ...detached } = node;
      return detached;
    }),
  };
}

function renderComponentPixelAtPoint(document, availableNodes, component, point, options = {}) {
  const transparent = { red: 0, green: 0, blue: 0, alpha: 0 };
  const stack = options.stack ?? new Set();
  if (stack.has(component.id)) return { pixel: transparent, targetContribution: 0 };
  const sourceDocument = detachedComponentDocument(
    { ...document, nodes: availableNodes },
    component.id,
  );
  const sourceIndex = new Map(sourceDocument.nodes.map((node) => [node.id, node]));
  const sourceNodes = componentSourceNodes(sourceDocument.nodes, sourceIndex.get(component.id));
  const nextStack = new Set(stack);
  nextStack.add(component.id);
  let pixel = transparent;
  let targetContribution = 0;
  for (const candidate of sourceNodes) {
    const candidateKey = `${options.pathPrefix ?? component.id}/node:${candidate.id}`;
    if (candidate.type === "instance") {
      if (
        !isDesignNodeVisible(sourceDocument, candidate, sourceIndex) ||
        !pointVisibleThroughAncestorClips(sourceDocument, candidate, point, sourceIndex)
      ) {
        continue;
      }
      const nestedComponent = sourceIndex.get(candidate.componentId);
      if (
        !nestedComponent ||
        nestedComponent.type !== "component" ||
        nestedComponent.width <= 0 ||
        nestedComponent.height <= 0
      ) {
        continue;
      }
      const nestedPoint = mapInstancePointToComponent(
        sourceDocument,
        candidate,
        nestedComponent,
        point,
        sourceIndex,
      );
      if (!nestedPoint) continue;
      const nested = renderComponentPixelAtPoint(
        sourceDocument,
        sourceDocument.nodes,
        nestedComponent,
        nestedPoint,
        {
          ...options,
          stack: nextStack,
          pathPrefix: `${options.pathPrefix ?? component.id}/instance:${candidate.id}`,
        },
      );
      const opacity = effectiveDesignNodeOpacity(sourceDocument, candidate, sourceIndex);
      const overlayAlpha = nested.pixel.alpha * opacity;
      targetContribution =
        targetContribution * (1 - overlayAlpha) + nested.targetContribution * opacity;
      pixel = applyGroupOpacity(nested.pixel, opacity, pixel);
      continue;
    }
    if (
      candidate.type === "group" ||
      (candidate.type === "text" && options.includeText === false) ||
      !validHex(candidate.fill) ||
      !fillIsVisibleAtPoint(sourceDocument, candidate, point, sourceIndex)
    ) {
      continue;
    }
    const opacity = effectiveDesignNodeOpacity(sourceDocument, candidate, sourceIndex);
    targetContribution *= 1 - opacity;
    if (candidateKey === options.omitKey || options.omitKeys?.has(candidateKey)) continue;
    pixel = compositeRgba(rgbaFromHex(candidate.fill, opacity), pixel);
    if (candidateKey === options.trackKey || options.trackKeys?.has(candidateKey)) {
      targetContribution += opacity;
    }
  }
  return { pixel, targetContribution };
}

function componentTextOccurrences(document, availableNodes, component, options = {}) {
  const stack = options.stack ?? new Set();
  if (stack.has(component.id)) return [];
  const sourceDocument = detachedComponentDocument(
    { ...document, nodes: availableNodes },
    component.id,
  );
  const sourceIndex = new Map(sourceDocument.nodes.map((node) => [node.id, node]));
  const sourceNodes = componentSourceNodes(sourceDocument.nodes, sourceIndex.get(component.id));
  const pathPrefix = options.pathPrefix ?? component.id;
  const mapPoint = options.mapPoint ?? ((point) => point);
  const scaleY = options.scaleY ?? 1;
  const nextStack = new Set(stack);
  nextStack.add(component.id);
  const occurrences = [];
  for (const candidate of sourceNodes) {
    if (
      candidate.type === "text" &&
      String(candidate.text).trim() &&
      validHex(candidate.fill) &&
      isDesignNodeVisible(sourceDocument, candidate, sourceIndex)
    ) {
      occurrences.push({
        key: `${pathPrefix}/node:${candidate.id}`,
        sourceText: candidate,
        points: textSamplePoints(
          sourceDocument,
          candidate,
          String(candidate.text).split("\n"),
          sourceIndex,
        )
          .map(mapPoint)
          .filter(Boolean),
        scaleY,
      });
      continue;
    }
    if (candidate.type !== "instance") continue;
    const nestedComponent = sourceIndex.get(candidate.componentId);
    if (
      !nestedComponent ||
      nestedComponent.type !== "component" ||
      nestedComponent.width <= 0 ||
      nestedComponent.height <= 0
    ) {
      continue;
    }
    occurrences.push(
      ...componentTextOccurrences(sourceDocument, sourceDocument.nodes, nestedComponent, {
        stack: nextStack,
        pathPrefix: `${pathPrefix}/instance:${candidate.id}`,
        mapPoint: (point) =>
          mapPoint(
            mapComponentPointToInstance(
              sourceDocument,
              candidate,
              nestedComponent,
              point,
              sourceIndex,
            ),
          ),
        scaleY: scaleY * Math.abs(candidate.height / nestedComponent.height),
      }),
    );
  }
  return occurrences;
}

function groupedComponentTextOccurrences(occurrences) {
  const groups = new Map();
  for (const occurrence of occurrences) {
    const geometryKey = occurrence.points
      .map((point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`)
      .join(";");
    const key = `${occurrence.sourceText.id}|${occurrence.scaleY.toFixed(6)}|${geometryKey}`;
    const existing = groups.get(key);
    if (existing) {
      existing.keys.add(occurrence.key);
    } else {
      groups.set(key, { ...occurrence, keys: new Set([occurrence.key]) });
    }
  }
  return [...groups.values()];
}

function pageBackgroundAtPoint(document, index, nodeIndex, point, availableNodes) {
  let background = rgbaFromHex(document.canvas.background);
  for (let cursor = 0; cursor < index; cursor += 1) {
    const candidate = document.nodes[cursor];
    if (candidate.type === "text") continue;
    if (candidate.type === "instance") {
      if (
        !isDesignNodeVisible(document, candidate, nodeIndex) ||
        !pointVisibleThroughAncestorClips(document, candidate, point, nodeIndex)
      ) {
        continue;
      }
      const component = availableNodes.find(
        (node) => node.id === candidate.componentId && node.type === "component",
      );
      if (!component || component.width <= 0 || component.height <= 0) continue;
      const sourcePoint = mapInstancePointToComponent(
        document,
        candidate,
        component,
        point,
        nodeIndex,
      );
      if (!sourcePoint) continue;
      const rendered = renderComponentPixelAtPoint(
        document,
        availableNodes,
        component,
        sourcePoint,
        { includeText: false },
      );
      background = applyGroupOpacity(
        rendered.pixel,
        effectiveDesignNodeOpacity(document, candidate, nodeIndex),
        background,
      );
      continue;
    }
    if (!fillIsVisibleAtPoint(document, candidate, point, nodeIndex)) continue;
    background = compositeRgba(
      rgbaFromHex(candidate.fill, effectiveDesignNodeOpacity(document, candidate, nodeIndex)),
      background,
    );
  }
  return background;
}

function auditInstanceTextContrast(document, nodeIndex) {
  const issues = [];
  const availableNodes = allReadableDesignNodes(document);
  const availableIndex = new Map(availableNodes.map((node) => [node.id, node]));
  document.nodes.forEach((instance, instanceIndex) => {
    if (instance.type !== "instance" || !isDesignNodeVisible(document, instance, nodeIndex)) return;
    const component = availableIndex.get(instance.componentId);
    if (
      !component ||
      component.type !== "component" ||
      component.width <= 0 ||
      component.height <= 0
    )
      return;
    const instanceOpacity = effectiveDesignNodeOpacity(document, instance, nodeIndex);
    const occurrences = groupedComponentTextOccurrences(
      componentTextOccurrences(document, availableNodes, component),
    );
    occurrences.forEach((occurrence) => {
      const ratios = occurrence.points
        .map((sourcePoint) => {
          const targetPoint = mapComponentPointToInstance(
            document,
            instance,
            component,
            sourcePoint,
            nodeIndex,
          );
          if (
            !targetPoint ||
            !pointVisibleThroughAncestorClips(document, instance, targetPoint, nodeIndex)
          ) {
            return null;
          }
          const externalBackground = pageBackgroundAtPoint(
            document,
            instanceIndex,
            nodeIndex,
            targetPoint,
            availableNodes,
          );
          const rendered = renderComponentPixelAtPoint(
            document,
            availableNodes,
            component,
            sourcePoint,
            { trackKeys: occurrence.keys },
          );
          if (rendered.targetContribution * instanceOpacity <= 1e-6) return null;
          const withoutText = renderComponentPixelAtPoint(
            document,
            availableNodes,
            component,
            sourcePoint,
            { omitKeys: occurrence.keys },
          );
          const renderedText = applyGroupOpacity(
            rendered.pixel,
            instanceOpacity,
            externalBackground,
          );
          const renderedBackground = applyGroupOpacity(
            withoutText.pixel,
            instanceOpacity,
            externalBackground,
          );
          return contrastRatio(
            opaqueHexFromRgba(renderedText),
            opaqueHexFromRgba(renderedBackground),
          );
        })
        .filter((ratio) => ratio != null);
      if (ratios.length === 0) return;
      const ratio = Math.min(...ratios);
      const sourceText = occurrence.sourceText;
      const renderedFontSize =
        sourceText.fontSize * occurrence.scaleY * Math.abs(instance.height / component.height);
      const largeText =
        renderedFontSize >= 24 || (renderedFontSize >= 18 && sourceText.fontWeight >= 700);
      const required = largeText ? 3 : 4.5;
      if (ratio >= required) return;
      issues.push({
        code: "a11y.instance-text-contrast",
        severity: "warning",
        blocking: false,
        nodeId: instance.id,
        sourceNodeId: sourceText.id,
        message: `实例「${instance.name}」中的文字「${sourceText.name}」对比度 ${ratio.toFixed(2)}:1，建议至少 ${required}:1`,
      });
    });
  });
  return issues;
}

export function auditDesign(document) {
  const issues = [];
  const canvas = { x: 0, y: 0, width: document.canvas.width, height: document.canvas.height };
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const availableNodes = allReadableDesignNodes(document);
  const effectivelyVisible = (node) => {
    if (!node.visible || node.opacity <= 0) return false;
    const seen = new Set();
    let parentId = node.parentId;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      if (!parent.visible || parent.opacity <= 0) return false;
      parentId = parent.parentId;
    }
    return true;
  };
  document.nodes.forEach((node, index) => {
    let parent = null;
    if (node.parentId) {
      parent = byId.get(node.parentId);
      if (!parent || !["frame", "group", "component"].includes(parent.type)) {
        issues.push({
          code: "structure.parent-missing",
          severity: "error",
          blocking: true,
          nodeId: node.id,
          message: `父级容器不存在：${node.parentId}`,
        });
      }
    }
    if (!effectivelyVisible(node)) return;
    const visualBounds = transformedNodeBoundsInTree(document.nodes, node, byId);
    if (!visualBounds || !contains(canvas, visualBounds)) {
      issues.push({
        code: "layout.canvas-overflow",
        severity: "error",
        blocking: true,
        nodeId: node.id,
        message: "图层超出文档画布边界",
      });
    }
    const effectCorners = nodeEffectCornersInTree(document, node, byId);
    const effectBounds = boundsForPoints(effectCorners);
    if (
      effectBounds &&
      visualBounds &&
      contains(canvas, visualBounds) &&
      node.effectClipping !== "intentional" &&
      !contains(canvas, effectBounds)
    ) {
      issues.push({
        code: "layout.effect-canvas-overflow",
        severity: "error",
        blocking: true,
        nodeId: node.id,
        message: "图层描边、投影或实例内容超出文档画布边界并会被裁切",
      });
    }
    if (node.parentId && parent && ["frame", "group", "component"].includes(parent.type)) {
      const localVisualBounds = transformedNodeBounds(node);
      const exceedsParent =
        !localVisualBounds ||
        !contains(parent, localVisualBounds) ||
        (parent.clipContent === true &&
          exceedsClippingAncestor(document.nodes, node, parent, byId));
      if (exceedsParent) {
        issues.push({
          code: "layout.parent-overflow",
          severity: parent.clipContent === true ? "error" : "warning",
          blocking: parent.clipContent === true,
          nodeId: node.id,
          message:
            parent.clipContent === true
              ? `图层超出所属容器「${parent.name}」并会被裁切`
              : `图层超出所属容器「${parent.name}」`,
        });
      }
      const seenAncestors = new Set();
      let ancestorId = parent.parentId;
      while (ancestorId && !seenAncestors.has(ancestorId)) {
        seenAncestors.add(ancestorId);
        const ancestor = byId.get(ancestorId);
        if (!ancestor) break;
        if (
          ancestor.clipContent === true &&
          exceedsClippingAncestor(document.nodes, node, ancestor, byId)
        ) {
          issues.push({
            code: "layout.ancestor-clip-overflow",
            severity: "error",
            blocking: true,
            nodeId: node.id,
            message: `图层超出祖先裁切容器「${ancestor.name}」并会被裁切`,
          });
          break;
        }
        ancestorId = ancestor.parentId;
      }
    }
    if (effectCorners && node.parentId) {
      const seenClippingAncestors = new Set();
      let clippingAncestorId = node.parentId;
      while (clippingAncestorId && !seenClippingAncestors.has(clippingAncestorId)) {
        seenClippingAncestors.add(clippingAncestorId);
        const clippingAncestor = byId.get(clippingAncestorId);
        if (!clippingAncestor) break;
        if (
          clippingAncestor.clipContent === true &&
          node.effectClipping !== "intentional" &&
          !exceedsClippingAncestor(document.nodes, node, clippingAncestor, byId) &&
          !isIntentionalClippedEdgeSurface(node, clippingAncestor) &&
          effectCorners.some(
            (point) => !pointInNodeShape(document.nodes, clippingAncestor, point, byId, 0.5),
          )
        ) {
          issues.push({
            code: "layout.effect-clip-overflow",
            severity: "error",
            blocking: true,
            nodeId: node.id,
            message: `图层描边、投影或实例内容超出祖先裁切容器「${clippingAncestor.name}」并会被裁切`,
          });
          break;
        }
        clippingAncestorId = clippingAncestor.parentId;
      }
    }
    if (node.type !== "text") return;
    if (!String(node.text).trim()) {
      issues.push({
        code: "content.empty-text",
        severity: "warning",
        blocking: false,
        nodeId: node.id,
        message: "文本内容为空",
      });
      return;
    }
    const lines = String(node.text).split("\n");
    const lineCount = lines.length;
    const minimumTextHeight =
      node.fontSize + Math.max(0, lineCount - 1) * node.fontSize * node.lineHeight;
    if (node.height + 0.5 < minimumTextHeight) {
      issues.push({
        code: "layout.text-overflow",
        severity: "error",
        blocking: true,
        nodeId: node.id,
        message: `文本高度不足：当前 ${node.height}px，至少需要约 ${Math.ceil(minimumTextHeight)}px`,
      });
    }
    const widestLine = Math.max(0, ...lines.map((line) => estimateTextLineWidth(node, line)));
    if (node.textMeasurement !== "browser" && node.width + 0.5 < widestLine) {
      issues.push({
        code: "layout.text-width-overflow",
        severity: "error",
        blocking: true,
        nodeId: node.id,
        message: `文本宽度不足：当前 ${node.width}px，最长一行约需 ${Math.ceil(widestLine)}px；请增宽、换行或缩短文案`,
      });
    }
    if (node.fill === "transparent") {
      issues.push({
        code: "content.invisible-text",
        severity: "warning",
        blocking: false,
        nodeId: node.id,
        message: "文字填充透明，内容不可见",
      });
      return;
    }
    const sampledRatios = textSamplePoints(document, node, lines, byId)
      .map((point) => {
        const background = opaqueHexFromRgba(
          pageBackgroundAtPoint(document, index, byId, point, availableNodes),
        );
        const renderedFill = blendHex(
          node.fill,
          background,
          effectiveDesignNodeOpacity(document, node, byId),
        );
        return contrastRatio(renderedFill, background);
      })
      .filter((ratio) => ratio != null);
    if (sampledRatios.length === 0) return;
    const ratio = Math.min(...sampledRatios);
    const largeText = node.fontSize >= 24 || (node.fontSize >= 18 && node.fontWeight >= 700);
    const required = largeText ? 3 : 4.5;
    if (ratio < required) {
      issues.push({
        code: "a11y.text-contrast",
        severity: "warning",
        blocking: false,
        nodeId: node.id,
        message: `文字对比度 ${ratio.toFixed(2)}:1，建议至少 ${required}:1`,
      });
    }
  });
  const containers = document.nodes.filter(
    (node) =>
      effectivelyVisible(node) &&
      ["frame", "group", "component"].includes(node.type),
  );
  if (
    containers.length >= 12 &&
    !containers.some((node) => ["horizontal", "vertical", "grid"].includes(node.layout))
  ) {
    const root =
      containers.find((node) => !node.parentId) ??
      containers.reduce((largest, node) =>
        node.width * node.height > largest.width * largest.height ? node : largest,
      );
    issues.push({
      code: "layout.manual-only-ui",
      severity: "warning",
      blocking: false,
      nodeId: root.id,
      message: `文档包含 ${containers.length} 个容器但没有使用 Auto Layout；界面类设计应优先用 horizontal/vertical/grid、wrap、gap、padding 和双轴 Hug/Fill/Fixed，让 x/y 只承担手工布局、绝对子节点与降级定位`,
    });
  }
  issues.push(...auditInstanceTextContrast(document, byId));
  return issues;
}

export function auditDesignPages(document) {
  const pages = Array.isArray(document?.pages) ? document.pages : [];
  if (pages.length === 0) return auditDesign(document);
  const readablePages = pages.map((page) =>
    page.id === document.activePageId ? { ...page, nodes: document.nodes ?? [] } : page,
  );
  const issues = [];
  for (const page of readablePages) {
    for (const issue of auditDesign({
      ...document,
      activePageId: page.id,
      pages: readablePages,
      nodes: page.nodes,
    })) {
      issues.push({
        ...issue,
        pageId: page.id,
        pageName: page.name,
      });
    }
  }
  return issues;
}

export function summarizeAudit(issues) {
  const list = Array.isArray(issues) ? issues : [];
  const errors = list.filter((issue) => issue.severity === "error").length;
  const warnings = list.filter((issue) => issue.severity === "warning").length;
  const blocking = list.filter(
    (issue) => issue.blocking === true || issue.severity === "error",
  ).length;
  return {
    valid: list.length === 0,
    renderSafe: blocking === 0,
    issueCount: list.length,
    blockingIssueCount: blocking,
    errorCount: errors,
    warningCount: warnings,
  };
}

export function auditMarkdown(document, issues, sourcePath) {
  const summary = summarizeAudit(issues);
  const escapeCell = (value) =>
    String(value)
      .replaceAll("\\", "\\\\")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("|", "\\|")
      .replaceAll("`", "\\`")
      .replace(/([*_[\]{}()#+.!])/gu, "\\$1")
      .replaceAll("\r", " ")
      .replaceAll("\n", " ");
  const inlineCode = (value) => {
    const text = String(value).replaceAll("\n", " ");
    const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
    const fence = "`".repeat(longestRun + 1);
    const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
    return `${fence}${padding}${text}${padding}${fence}`;
  };
  const lines = [
    `# Design audit: ${escapeCell(document.name)}`,
    "",
    `Source: ${inlineCode(sourcePath)}`,
    "",
    `Summary: ${summary.issueCount} issue(s), ${summary.blockingIssueCount} blocking, ${summary.errorCount} error(s), ${summary.warningCount} warning(s).`,
    "",
  ];
  if (issues.length === 0) {
    lines.push("No issues found.", "");
    return lines.join("\n");
  }
  const pages = Array.isArray(document.pages) ? document.pages : [];
  const names = new Map();
  for (const page of pages) {
    const nodes = page.id === document.activePageId ? document.nodes : page.nodes;
    for (const node of nodes ?? []) names.set(node.id, node.name);
  }
  if (pages.length === 0) {
    for (const node of document.nodes ?? []) names.set(node.id, node.name);
  }
  lines.push(
    "| Severity | Impact | Page | Code | Layer | Node ID | Finding |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const issue of issues) {
    lines.push(
      `| ${issue.severity} | ${issue.blocking ? "blocking" : "required"} | ${escapeCell(issue.pageName ?? issue.pageId ?? document.activePageId ?? "Page 1")} | ${inlineCode(issue.code)} | ${escapeCell(names.get(issue.nodeId) ?? issue.nodeId)} | ${inlineCode(issue.nodeId)} | ${escapeCell(issue.message)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
