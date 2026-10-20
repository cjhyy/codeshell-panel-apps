import { effectiveCornerRadii } from "../corner-radii.mjs";
/* Retained CanvasKit renderer. The document and editing state remain owned by Design Studio. */
import { effectiveDesignNodeOpacity, isDesignNodeVisible } from "../document.mjs";
import { designFillPaints, gradientMatrix } from "../paint.mjs";
import { hasDesignStroke, designStrokePaths, designStrokeOutset } from "../stroke.mjs";
import { transformedNodeBoundsInTree } from "../geometry.mjs";
import { createCanvasKitText } from "./canvaskit-text.mjs";

export const CANVASKIT_VERSION = "0.42.0";
const modules = new Map();
const MAX_PIXELS = 16 * 1024 * 1024;
export const CANVASKIT_TILE_CACHE = Object.freeze({
  tilePixels: 512,
  gutterPixels: 2,
  maxBytes: 64 * 1024 * 1024,
  maxPixels: 16 * 1024 * 1024,
  maxPhysicalScale: 1,
});
const MAX_NODE_PICTURE_BYTES = 64 * 1024 * 1024;
const resourceIdentities = new WeakMap();
let resourceSequence = 0;
function resourceFingerprint(design, resources, fallbackFontUrls) {
  const descriptors = new Map((design.resources ?? []).map((value) => [value.id, value]));
  const urls =
    fallbackFontUrls instanceof Map ? fallbackFontUrls : new Map(Object.entries(fallbackFontUrls));
  return JSON.stringify([
    Array.from(resources, ([id, resource]) => {
      const descriptor = resource.descriptor ?? descriptors.get(id) ?? {};
      let identity = descriptor.sha256;
      if (!identity) {
        if (!resourceIdentities.has(resource.bytes))
          resourceIdentities.set(resource.bytes, ++resourceSequence);
        identity = resourceIdentities.get(resource.bytes);
      }
      return [
        id,
        identity,
        resource.bytes.byteLength,
        descriptor.kind,
        descriptor.mime,
        descriptor.family,
        descriptor.weight,
        descriptor.style,
        resource.mimeType,
      ];
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    fallbackFontUrls instanceof Map ? [...fallbackFontUrls] : fallbackFontUrls,
    [
      ...new Set(
        design.nodes
          .filter((node) => node.type === "text" && !node.fontRef && urls.has(node.fontFamily))
          .map((node) => node.fontFamily),
      ),
    ].sort(),
  ]);
}

const now = () => performance.now();
const rect = (CK, n) => CK.XYWHRect(n.x, n.y, Math.max(1, n.width), Math.max(1, n.height));

async function loadCanvasKit(assetsBaseUrl, document) {
  if (!assetsBaseUrl)
    throw new Error(
      "CanvasKit needs a local assetsBaseUrl containing canvaskit.js and canvaskit.wasm",
    );
  const base = new URL(
    assetsBaseUrl.endsWith("/") ? assetsBaseUrl : `${assetsBaseUrl}/`,
    document.baseURI,
  );
  if (!modules.has(base.href)) {
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("canvaskit.js", base).href;
      script.onload = () => {
        if (typeof globalThis.CanvasKitInit !== "function")
          reject(new Error("CanvasKitInit is missing"));
        else resolve(globalThis.CanvasKitInit({ locateFile: (file) => new URL(file, base).href }));
      };
      script.onerror = () => reject(new Error(`Cannot load CanvasKit ${CANVASKIT_VERSION}`));
      document.head.append(script);
    });
    modules.set(base.href, promise);
    promise.catch(() => modules.delete(base.href));
  }
  return modules.get(base.href);
}

export function canvasKitColor(CK, value, opacity = 1) {
  if (!value || value === "none" || value === "transparent") return CK.Color(0, 0, 0, 0);
  if (!/^#[a-f\d]{6}$/iu.test(value)) throw new Error(`Unsupported color: ${value}`);
  return CK.Color(
    ...[1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16)),
    opacity,
  );
}

function makePaint(CK, node, fill, offset = { x: 0, y: 0 }) {
  const paint = new CK.Paint();
  paint.setAntiAlias(true);
  if (fill.type === "SOLID") paint.setColor(canvasKitColor(CK, fill.color, fill.opacity));
  else if (fill.type === "GRADIENT_LINEAR") {
    const [[a, b, c], [d, e, f]] = gradientMatrix(fill.handles);
    const matrix = [
      node.width * a,
      node.width * b,
      node.x - offset.x + node.width * c,
      node.height * d,
      node.height * e,
      node.y - offset.y + node.height * f,
      0,
      0,
      1,
    ];
    const shader = CK.Shader.MakeLinearGradient(
      [0, 0.5],
      [1, 0.5],
      fill.stops.map((stop) => canvasKitColor(CK, stop.color, stop.opacity)),
      fill.stops.map((stop) => stop.position),
      CK.TileMode.Clamp,
      matrix,
      0,
      CK.ColorSpace.SRGB,
    );
    if (!shader) {
      paint.delete();
      throw new Error("Cannot create linear gradient");
    }
    paint.setShader(shader);
    paint.setAlphaf(fill.opacity);
    shader.delete();
  } else {
    paint.delete();
    throw new Error(`Unsupported paint: ${fill.type}`);
  }
  return paint;
}

function ancestors(node, index) {
  const result = [],
    seen = new Set([node.id]);
  let id = node.parentId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const parent = index.get(id);
    if (!parent) break;
    result.unshift(parent);
    id = parent.parentId;
  }
  return result;
}

function rotateChain(canvas, chain, inverse = false) {
  for (const node of inverse ? [...chain].reverse() : chain) {
    if (node.rotation)
      canvas.rotate(
        (inverse ? -1 : 1) * node.rotation,
        node.x + node.width / 2,
        node.y + node.height / 2,
      );
  }
}

function roundedRect(CK, node) {
  return [...rect(CK, node), ...effectiveCornerRadii(node).flatMap((radius) => [radius, radius])];
}

function clipAncestors(CK, canvas, chain) {
  const prefix = [];
  for (const node of chain) {
    prefix.push(node);
    if (!["frame", "component"].includes(node.type) || !node.clipContent) continue;
    rotateChain(canvas, prefix);
    canvas.clipRRect(roundedRect(CK, node), CK.ClipOp.Intersect, true);
    rotateChain(canvas, prefix, true);
  }
}

function drawShape(CK, canvas, node, paint) {
  if (node.type === "ellipse") canvas.drawOval(rect(CK, node), paint);
  else {
    canvas.drawRRect(roundedRect(CK, node), paint);
  }
}

function drawMissing(CK, canvas, node) {
  const paint = new CK.Paint();
  paint.setAntiAlias(true);
  paint.setColor(canvasKitColor(CK, "#fff0f3"));
  canvas.drawRect(rect(CK, node), paint);
  paint.setStyle(CK.PaintStyle.Stroke);
  paint.setStrokeWidth(1.5);
  paint.setColor(canvasKitColor(CK, "#ff5c78"));
  const dash = CK.PathEffect.MakeDash([6, 4]);
  paint.setPathEffect(dash);
  canvas.drawRect(rect(CK, node), paint);
  dash.delete();
  paint.delete();
}

function drawImage(CK, canvas, node, image) {
  canvas.save();
  canvas.clipRRect(roundedRect(CK, node), CK.ClipOp.Intersect, true);
  const width = image.width(),
    height = image.height();
  let source = CK.XYWHRect(0, 0, width, height),
    destination = rect(CK, node);
  if (node.objectFit === "contain") {
    const scale = Math.min(node.width / width, node.height / height);
    destination = CK.XYWHRect(
      node.x + (node.width - width * scale) / 2,
      node.y + (node.height - height * scale) / 2,
      width * scale,
      height * scale,
    );
  } else if (node.objectFit !== "fill") {
    const scale = Math.max(node.width / width, node.height / height);
    const w = node.width / scale,
      h = node.height / scale;
    source = CK.XYWHRect((width - w) / 2, (height - h) / 2, w, h);
  }
  const paint = new CK.Paint();
  paint.setAntiAlias(true);
  canvas.drawImageRectOptions(
    image,
    source,
    destination,
    CK.FilterMode.Linear,
    CK.MipmapMode.None,
    paint,
  );
  paint.delete();
  canvas.restore();
}

/** resources are decoded bytes, never screenshots of the scene. Extra fonts are optional real font URLs. */
export async function createRenderer({
  canvas,
  assetsBaseUrl,
  fallbackFontUrls = {},
  background = "#ececea",
  tileCacheEnabled = true,
  deviceTextSampling = true,
}) {
  if (!canvas?.ownerDocument) throw new Error("CanvasKit renderer requires a browser canvas");
  const CK = await loadCanvasKit(assetsBaseUrl, canvas.ownerDocument);
  const contextHandle = CK.GetWebGLContext(canvas, {
    majorVersion: 2,
    alpha: true,
    antialias: false,
    preserveDrawingBuffer: false,
  });
  if (!contextHandle)
    throw new Error("CanvasKit WebGL2 context unavailable; CPU fallback is disabled");
  const context = CK.MakeWebGLContext(contextHandle);
  if (!context) {
    CK.deleteContext(contextHandle);
    throw new Error("CanvasKit GPU context unavailable");
  }
  const gl = canvas.getContext("webgl2");
  const debug = gl?.getExtension("WEBGL_debug_renderer_info");
  const gpuRenderer = gl
    ? gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)
    : "unavailable";
  let surface = null,
    picture = null,
    sceneState = null,
    disposed = false;
  let dpr = 1,
    cssWidth = canvas.width || 1,
    cssHeight = canvas.height || 1;
  let generation = 0,
    frames = 0,
    builds = 0,
    lastRenderMs = 0,
    lastSetSceneMs = 0;
  let sceneStats = {},
    owned = [],
    sceneImages = new Map(),
    resourceKey = null;
  let nodePictures = new Map(),
    currentDesign = null,
    recordCurrentScene = null;
  let sceneNodes = [],
    sceneIndex = new Map(),
    sceneChildren = new Map(),
    hasInstances = false,
    deviceTextCandidates = [],
    deviceCandidateOrigins = new Map();
  let sceneRevision = 0,
    resourceBuilds = 0,
    nodePictureBuilds = 0,
    nodePictureHits = 0,
    nodePictureBytes = 0,
    qualityBuilds = 0,
    deviceSamplingBuilds = 0;
  const tileCache = new Map();
  let tileBytes = 0,
    tileBuilds = 0,
    tileHits = 0,
    tileEvictions = 0;
  let lastTileCount = 0,
    lastTileBuildMs = 0,
    lastMode = "vector";
  const clearTiles = () => {
    for (const tile of tileCache.values()) tile.image.delete();
    tileCache.clear();
    tileBytes = 0;
  };
  const clearNodePictures = (cache = nodePictures) => {
    for (const value of cache.values()) value.picture.delete();
    cache.clear();
  };
  const assertLive = () => {
    if (disposed) throw new Error("CanvasKit renderer is disposed");
    if (!gl || gl.isContextLost())
      throw new Error("CanvasKit WebGL context lost; CPU fallback is disabled");
  };
  const releaseScene = () => {
    picture?.delete();
    picture = null;
    for (const value of owned.reverse()) value.delete?.();
    owned = [];
    sceneState?.dispose();
    sceneState = null;
    sceneImages = new Map();
    resourceKey = null;
    clearNodePictures();
    clearTiles();
  };

  function resize(width, height, pixelRatio = 1) {
    assertLive();
    if (![width, height, pixelRatio].every((n) => Number.isFinite(n) && n > 0))
      throw new Error("Invalid viewport dimensions");
    const w = Math.ceil(width * pixelRatio),
      h = Math.ceil(height * pixelRatio);
    if (w > 8192 || h > 8192 || w * h > MAX_PIXELS)
      throw new Error("CanvasKit viewport exceeds the bounded pixel budget");
    if (surface && canvas.width === w && canvas.height === h) {
      dpr = pixelRatio;
      cssWidth = width;
      cssHeight = height;
      return;
    }
    surface?.delete();
    surface = null;
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    surface = CK.MakeOnScreenGLSurface(context, w, h, CK.ColorSpace.SRGB);
    if (!surface) throw new Error("CanvasKit cannot create a GPU surface");
    cssWidth = width;
    cssHeight = height;
    dpr = pixelRatio;
  }
  resize(cssWidth, cssHeight, 1);

  async function setScene(design, { resources = new Map() } = {}) {
    assertLive();
    const started = now(),
      current = ++generation;
    if (!Array.isArray(design?.nodes) || !design.canvas)
      throw new Error("setScene requires a normalized flat Design document");
    const unsupported = [],
      seenUnsupported = new Set();
    const unsupportedNode = (node, code, detail) => {
      const key = `${node.id}:${code}`;
      if (!seenUnsupported.has(key)) {
        seenUnsupported.add(key);
        unsupported.push({ nodeId: node.id, code, detail });
      }
    };
    const counters = {
      inputNodes: design.nodes.length,
      visibleNodes: 0,
      drawnNodes: 0,
      drawVisits: 0,
      nativeTextNodes: 0,
      rasterTextNodes: 0,
      textLines: 0,
      missingImages: 0,
      decodedImages: 0,
      gradientPaints: 0,
      shadowNodes: 0,
      clippedNodes: 0,
      rotatedNodes: 0,
      opacityNodes: 0,
      instanceNodes: 0,
    };
    const nextResourceKey = resourceFingerprint(design, resources, fallbackFontUrls);
    const reuseResources = Boolean(sceneState && resourceKey === nextResourceKey);
    const nextOwned = reuseResources ? owned : [],
      images = reuseResources ? sceneImages : new Map();
    const nextNodePictures = reuseResources ? nodePictures : new Map();
    const text = reuseResources
      ? sceneState
      : await createCanvasKitText({
          CK,
          design,
          resources,
          document: canvas.ownerDocument,
          fallbackFontUrls,
          unsupportedNode,
          counters,
          makePaint: (node, fill, offset) => makePaint(CK, node, fill, offset),
        });
    if (disposed || current !== generation) {
      if (!reuseResources) text.dispose();
      return;
    }
    let nextPicture;
    try {
      if (!reuseResources)
        for (const [id, resource] of resources) {
          const descriptor = resource.descriptor ?? design.resources?.find((r) => r.id === id);
          if (descriptor?.kind !== "image" && !resource.mimeType?.startsWith("image/")) continue;
          const image = CK.MakeImageFromEncoded(resource.bytes);
          if (image) {
            images.set(id, image);
            nextOwned.push(image);
            counters.decodedImages++;
          }
        }
      counters.decodedImages = images.size;
      text.beginScene?.(design);
      const pageNodes = design.pages?.length
        ? design.pages.flatMap((page) =>
            page.id === design.activePageId ? design.nodes : (page.nodes ?? []),
          )
        : design.nodes;
      const index = new Map(pageNodes.map((node) => [node.id, node]));
      const children = new Map();
      for (const node of pageNodes) {
        if (!children.has(node.parentId)) children.set(node.parentId, []);
        children.get(node.parentId).push(node);
      }
      const activeIds = new Set(pageNodes.map((node) => node.id));
      for (const [id, entry] of nextNodePictures)
        if (!activeIds.has(id)) {
          entry.picture.delete();
          nextNodePictures.delete(id);
        }
      let nextNodeBytes = [...nextNodePictures.values()].reduce(
        (sum, entry) => sum + entry.bytes,
        0,
      );
      const record = () => {
        for (const key of Object.keys(counters))
          if (key !== "inputNodes" && key !== "decodedImages") counters[key] = 0;
        unsupported.length = 0;
        seenUnsupported.clear();
        const recorder = new CK.PictureRecorder();
        try {
          // A generous cull rect permits out-of-artboard nodes/shadows without allocating a giant bitmap.
          // CanvasKit's computeBounds flag builds Skia's R-tree for viewport culling.
          const target = recorder.beginRecording(
            CK.LTRBRect(-100000, -100000, 100000, 100000),
            true,
          );
          const background = new CK.Paint();
          background.setColor(canvasKitColor(CK, design.canvas.background));
          target.drawRect(CK.XYWHRect(0, 0, design.canvas.width, design.canvas.height), background);
          background.delete();

          const rawCounterKeys = [
            "nativeTextNodes",
            "rasterTextNodes",
            "textLines",
            "missingImages",
            "gradientPaints",
          ];
          function drawRawContent(destination, node) {
            if (node.type === "image") {
              const image = images.get(node.imageRef);
              if (image) drawImage(CK, destination, node, image);
              else {
                if (resources.has(node.imageRef))
                  unsupportedNode(node, "image-decode", "Image bytes could not be decoded");
                counters.missingImages++;
                drawMissing(CK, destination, node);
              }
              return;
            }
            if (node.type === "text") {
              text.draw(destination, node, counters, unsupportedNode);
              return;
            }
            if (!["rectangle", "frame", "component", "ellipse"].includes(node.type)) {
              unsupportedNode(node, "node-type", node.type);
              drawMissing(CK, destination, node);
              return;
            }
            for (const fill of designFillPaints(node)) {
              if (fill.type === "GRADIENT_LINEAR") counters.gradientPaints++;
              const paint = makePaint(CK, node, fill);
              drawShape(CK, destination, node, paint);
              paint.delete();
            }
            if (hasDesignStroke(node)) {
              const parts=designStrokePaths(node),common=parts.every(s=>s.opacity===parts[0]?.opacity);
              const layered=parts.length && common && parts[0].opacity<1,layer=layered?new CK.Paint():null;
              if(layer){layer.setAlphaf(parts[0].opacity);destination.saveLayer(layer);}
              for (const part of parts) {
                const path=CK.Path.MakeFromSVGString(part.path),paint=new CK.Paint();
                if(!path)throw new Error("Generated border path is invalid");
                path.setFillType(part.rule === "evenodd" ? CK.FillType.EvenOdd : CK.FillType.Winding);
                paint.setAntiAlias(true);paint.setColor(canvasKitColor(CK,part.color));paint.setAlphaf(common?1:part.opacity);
                destination.drawPath(path,paint);paint.delete();path.delete();
              }
              if(layer){destination.restore();layer.delete();}
            } else if (node.strokeWidth > 0 && !["none", "transparent"].includes(node.stroke)) {
              const stroke = new CK.Paint();
              stroke.setAntiAlias(true);
              stroke.setStyle(CK.PaintStyle.Stroke);
              stroke.setColor(canvasKitColor(CK, node.stroke));
              stroke.setStrokeWidth(node.strokeWidth);
              drawShape(CK, destination, node, stroke);
              stroke.delete();
            }
          }
          function drawCachedContent(node) {
            // Raw commands use node-local coordinates. Moving a frame or its
            // descendants changes the outer transform, not glyph shaping/paints.
            const local = { ...node, x: 0, y: 0, rotation: 0, opacity: 1 };
            delete local.parentId;
            delete local.shadow;
            delete local.name;
            delete local.locked;
            const signature = JSON.stringify([local, text.rasterScaleForNode?.(node) ?? 2, text.rasterSamplingForNode?.(node)]);
            let entry = nextNodePictures.get(node.id);
            if (entry?.signature === signature) {
              nodePictureHits++;
              for (const key of rawCounterKeys) counters[key] += entry.delta[key];
              for (const issue of entry.issues) unsupportedNode(node, issue.code, issue.detail);
            } else {
              const content = new CK.PictureRecorder();
              // Bound raw commands conservatively before ancestors/effects are
              // applied by the outer display list. Text may extend beyond its box.
              const pad = Math.max(node.strokeWidth || 0,designStrokeOutset(node)) + 2;
              const bounds = node.type === "text" ? text.contentBounds(local) : local;
              const before = Object.fromEntries(rawCounterKeys.map((key) => [key, counters[key]]));
              const issueStart = unsupported.length;
              let prepared;
              try {
                const rawCanvas = content.beginRecording(
                  CK.XYWHRect(
                    bounds.x - pad,
                    bounds.y - pad,
                    bounds.width + pad * 2,
                    bounds.height + pad * 2,
                  ),
                  true,
                );
                drawRawContent(rawCanvas, local);
                prepared = content.finishRecordingAsPicture();
              } finally {
                content.delete();
              }
              const bytes = prepared.approximateBytesUsed();
              if (nextNodeBytes - (entry?.bytes ?? 0) + bytes > MAX_NODE_PICTURE_BYTES) {
                prepared.delete();
                throw new Error(
                  "CanvasKit retained node pictures exceed the bounded display-list budget",
                );
              }
              nextNodeBytes += bytes - (entry?.bytes ?? 0);
              entry?.picture.delete();
              entry = {
                signature,
                picture: prepared,
                bytes,
                delta: Object.fromEntries(
                  rawCounterKeys.map((key) => [key, counters[key] - before[key]]),
                ),
                issues: unsupported.slice(issueStart),
              };
              nextNodePictures.set(node.id, entry);
              nodePictureBuilds++;
            }
            target.save();
            target.translate(node.x, node.y);
            target.drawPicture(entry.picture);
            target.restore();
          }
          function drawNode(node, nodeIndex = index, stack = new Set()) {
            if (!isDesignNodeVisible({ nodes: pageNodes }, node, nodeIndex)) return;
            counters.drawVisits++;
            const chain = ancestors(node, nodeIndex);
            target.save();
            try {
              clipAncestors(CK, target, chain);
              if (
                chain.some(
                  (parent) => ["frame", "component"].includes(parent.type) && parent.clipContent,
                )
              )
                counters.clippedNodes++;
              rotateChain(target, [...chain, node]);
              if ([...chain, node].some((item) => item.rotation)) counters.rotatedNodes++;
              const opacity = effectiveDesignNodeOpacity({ nodes: pageNodes }, node, nodeIndex);
              const layerPaint = new CK.Paint();
              layerPaint.setAlphaf(opacity);
              if (opacity < 1) counters.opacityNodes++;
              if (node.shadow?.opacity > 0 && node.type !== "group") {
                const s = node.shadow;
                const filter = CK.ImageFilter.MakeDropShadow(
                  s.x,
                  s.y,
                  s.blur / 2,
                  s.blur / 2,
                  canvasKitColor(CK, s.color, s.opacity),
                  null,
                );
                layerPaint.setImageFilter(filter);
                filter.delete();
                counters.shadowNodes++;
              }
              const layered = opacity < 1 || (node.shadow?.opacity > 0 && node.type !== "group");
              if (layered) target.saveLayer(layerPaint);
              layerPaint.delete();
              try {
                if (node.type === "group") return;
                if (node.type === "instance") {
                  counters.instanceNodes++;
                  const component = index.get(node.componentId);
                  if (!component || component.type !== "component" || stack.has(component.id)) {
                    unsupportedNode(
                      node,
                      "component-unavailable",
                      "Missing or recursive component",
                    );
                    drawMissing(CK, target, node);
                    return;
                  }
                  const detached = { ...component };
                  delete detached.parentId;
                  const sourceIndex = new Map(index);
                  sourceIndex.set(component.id, detached);
                  const nextStack = new Set(stack);
                  nextStack.add(component.id);
                  const descendants = new Set(),
                    queue = [component.id];
                  for (let i = 0; i < queue.length; i++)
                    for (const child of children.get(queue[i]) ?? []) {
                      if (!descendants.has(child.id)) {
                        descendants.add(child.id);
                        queue.push(child.id);
                      }
                    }
                  target.translate(node.x, node.y);
                  target.scale(node.width / component.width, node.height / component.height);
                  target.translate(-component.x, -component.y);
                  drawNode(detached, sourceIndex, nextStack);
                  for (const child of pageNodes)
                    if (descendants.has(child.id)) drawNode(child, sourceIndex, nextStack);
                  return;
                }
                drawCachedContent(node);
              } finally {
                if (layered) target.restore();
              }
            } finally {
              target.restore();
            }
          }
          for (const node of design.nodes) {
            if (!isDesignNodeVisible({ nodes: pageNodes }, node, index)) continue;
            counters.visibleNodes++;
            drawNode(node);
            counters.drawnNodes++;
          }
          return recorder.finishRecordingAsPicture();
        } finally {
          recorder.delete();
        }
      };
      nextPicture = record();
      if (!reuseResources) {
        releaseScene();
        resourceBuilds++;
      } else picture?.delete();
      picture = nextPicture;
      nextPicture = null;
      owned = nextOwned;
      sceneImages = images;
      resourceKey = nextResourceKey;
      sceneState = text;
      nodePictures = nextNodePictures;
      currentDesign = design;
      sceneNodes = pageNodes;
      sceneIndex = index;
      sceneChildren = children;
      hasInstances = design.nodes.some((node) => node.type === "instance");
      deviceTextCandidates = deviceTextSampling && !hasInstances
        ? design.nodes.filter((node) => node.type === "text" &&
            isDesignNodeVisible(design, node, index) &&
            ![...ancestors(node, index), node].some((item) => item.rotation))
          .map((node) => ({ id: node.id, bounds: text.contentBounds(node),
            pad: 0, origin: { x: node.x - Math.floor(node.x), y: node.y - Math.floor(node.y) } }))
        : [];
      deviceCandidateOrigins = new Map(deviceTextCandidates.map((candidate) => [candidate.id, candidate.origin]));
      nodePictureBytes = nextNodeBytes;
      sceneRevision++;
      clearTiles();
      builds++;
      lastSetSceneMs = now() - started;
      const updateStats = () => {
        sceneStats = {
          ...counters,
          ...text.stats(),
          unsupported: [...unsupported],
          unsupportedCount: unsupported.length,
          pictureBytes: picture.approximateBytesUsed(),
          canvas: { ...design.canvas },
        };
      };
      updateStats();
      recordCurrentScene = (quality = true) => {
        const next = record();
        picture.delete();
        picture = next;
        nodePictureBytes = nextNodeBytes;
        sceneRevision++;
        clearTiles();
        if (quality) qualityBuilds++;
        else deviceSamplingBuilds++;
        updateStats();
      };
    } catch (error) {
      nextPicture?.delete();
      if (!reuseResources) {
        nextOwned.forEach((value) => value.delete());
        text.dispose();
        clearNodePictures(nextNodePictures);
      }
      throw error;
    }
  }

  function drawTiles(target, pan, zoom) {
    const scale = 2 ** (Math.ceil(Math.log2(zoom * dpr) * 2) / 2);
    const { tilePixels, gutterPixels, maxBytes } = CANVASKIT_TILE_CACHE;
    const size = tilePixels + gutterPixels * 2,
      worldSize = tilePixels / scale;
    const left = Math.floor(-pan.x / zoom / worldSize);
    const top = Math.floor(-pan.y / zoom / worldSize);
    const right = Math.ceil((cssWidth - pan.x) / zoom / worldSize);
    const bottom = Math.ceil((cssHeight - pan.y) / zoom / worldSize);
    if (![left, top, right, bottom].every(Number.isSafeInteger))
      throw new Error("CanvasKit tile coordinates exceed the bounded world range");
    const count = (right - left) * (bottom - top),
      bytes = size * size * 4;
    // A maximum-size viewport can exceed the texture cache budget after tile
    // rounding. Keep the original GPU vector path rather than thrash the cache.
    if (count * bytes > maxBytes) return false;
    const started = now();
    const paint = new CK.Paint();
    paint.setAntiAlias(false);
    try {
      for (let y = top; y < bottom; y++)
        for (let x = left; x < right; x++) {
          const key = `${sceneRevision}:${scale}:${x}:${y}`;
          let tile = tileCache.get(key);
          if (tile) {
            tileCache.delete(key);
            tileCache.set(key, tile);
            tileHits++;
          } else {
            while (tileBytes + bytes > maxBytes && tileCache.size) {
              const oldest = tileCache.keys().next().value,
                entry = tileCache.get(oldest);
              entry.image.delete();
              tileCache.delete(oldest);
              tileBytes -= entry.bytes;
              tileEvictions++;
            }
            const offscreen = CK.MakeRenderTarget(context, size, size);
            if (!offscreen || !offscreen.reportBackendTypeIsGPU()) {
              offscreen?.delete();
              throw new Error("CanvasKit GPU tile allocation failed; CPU fallback is disabled");
            }
            let image;
            try {
              const content = offscreen.getCanvas();
              content.clear(CK.TRANSPARENT);
              content.translate(gutterPixels, gutterPixels);
              content.scale(scale, scale);
              content.translate(-x * worldSize, -y * worldSize);
              // Replay the complete display list with the device tile clip. Skia
              // retains filter outsets, ancestor clips and compositing semantics.
              content.drawPicture(picture);
              offscreen.flush();
              image = offscreen.makeImageSnapshot();
              if (!image) throw new Error("CanvasKit GPU tile snapshot failed");
            } finally {
              offscreen.delete();
            }
            tile = { image, bytes };
            tileCache.set(key, tile);
            tileBytes += bytes;
            tileBuilds++;
          }
          // Gutters provide filter samples; only the non-overlapping interior is
          // composited, so transparent pixels and shadows are never drawn twice.
          target.drawImageRectOptions(
            tile.image,
            CK.XYWHRect(gutterPixels, gutterPixels, tilePixels, tilePixels),
            CK.XYWHRect(x * worldSize, y * worldSize, worldSize, worldSize),
            CK.FilterMode.Linear,
            CK.MipmapMode.None,
            paint,
          );
        }
    } finally {
      paint.delete();
    }
    lastTileCount = count;
    lastTileBuildMs = now() - started;
    return true;
  }

  function render({ pan = { x: 0, y: 0 }, zoom = 1 } = {}) {
    assertLive();
    if (!gl || gl.isContextLost())
      throw new Error("CanvasKit WebGL context lost; this frame was not rendered");
    if (![pan.x, pan.y, zoom].every(Number.isFinite) || zoom <= 0)
      throw new Error("Invalid viewport transform");
    // Match Skia's float32 matrix composition, including tiny residues left by
    // public wheel controls even when the effective device transform is exact.
    const physicalScale = Math.fround(Math.fround(zoom) * Math.fround(dpr));
    const deviceEligible = deviceTextSampling && !hasInstances && physicalScale === 1 &&
      Number.isInteger(Math.fround(Math.fround(pan.x) * Math.fround(dpr))) &&
      Number.isInteger(Math.fround(Math.fround(pan.y) * Math.fround(dpr)));
    const qualityNeeded = zoom * dpr > 2 || hasInstances;
    if (picture && currentDesign && sceneState.setRasterScale &&
        (qualityNeeded || deviceEligible || sceneState.hasDeviceSampling?.())) {
      const nodes = currentDesign.nodes,
        index = sceneIndex;
      const viewport = {
        x: -pan.x / zoom,
        y: -pan.y / zoom,
        width: cssWidth / zoom,
        height: cssHeight / zoom,
      };
      const visibleNodeIds = new Set(),
        nodeScales = new Map(),
        deviceOrigins = new Map();
      // Native pixel coverage is meaningful only at physical 1x with an integer
      // device translation. All other transforms retain the high-resolution
      // master. A shared component picture can also be used by scaled/rotated
      // instances, so scenes containing instances conservatively use masters.
      const overlaps = (bounds, pad = 0) =>
        bounds &&
        bounds.x - pad < viewport.x + viewport.width &&
        bounds.x + bounds.width + pad > viewport.x &&
        bounds.y - pad < viewport.y + viewport.height &&
        bounds.y + bounds.height + pad > viewport.y;
      if (deviceEligible) for (const candidate of deviceTextCandidates)
        if (overlaps(candidate.bounds, candidate.pad)) deviceOrigins.set(candidate.id, candidate.origin);
      if (qualityNeeded) for (const node of nodes) {
        if (node.type !== "text" || !isDesignNodeVisible(currentDesign, node, index)) continue;
        const bounds = transformedNodeBoundsInTree(sceneNodes, node, index),
          pad = node.fontSize * 2;
        if (overlaps(bounds, pad)) {
          visibleNodeIds.add(node.id);
        }
      }
      const includeComponent = (componentId, scale, seen = new Set()) => {
        if (seen.has(componentId)) return;
        const nextSeen = new Set(seen);
        nextSeen.add(componentId);
        const visit = (node) => {
          if (node.type === "text") {
            visibleNodeIds.add(node.id);
            nodeScales.set(node.id, Math.max(nodeScales.get(node.id) ?? zoom * dpr, scale));
          } else if (node.type === "instance") {
            const component = index.get(node.componentId);
            if (component?.type === "component")
              includeComponent(
                component.id,
                scale * Math.max(node.width / component.width, node.height / component.height),
                nextSeen,
              );
          }
          for (const child of sceneChildren.get(node.id) ?? []) visit(child);
        };
        const component = index.get(componentId);
        if (component) visit(component);
      };
      for (const node of nodes)
        if (
          node.type === "instance" &&
          isDesignNodeVisible(currentDesign, node, index) &&
          overlaps(transformedNodeBoundsInTree(sceneNodes, node, index))
        ) {
          const component = index.get(node.componentId);
          if (component?.type === "component")
            includeComponent(
              component.id,
              zoom * dpr * Math.max(node.width / component.width, node.height / component.height),
            );
        }
      const qualityChanged = qualityNeeded &&
        sceneState.setRasterScale(zoom * dpr, { visibleNodeIds, nodeScales });
      const samplingChanged = sceneState.setDeviceSampling?.(deviceOrigins, {
        retainOffscreen: deviceEligible, eligibleOrigins: deviceCandidateOrigins,
      });
      if (qualityChanged || samplingChanged) recordCurrentScene(Boolean(qualityChanged));
    }
    const started = now(),
      target = surface.getCanvas();
    target.clear(canvasKitColor(CK, background));
    target.save();
    target.scale(dpr, dpr);
    target.translate(pan.x, pan.y);
    target.scale(zoom, zoom);
    lastMode = "vector";
    lastTileCount = 0;
    lastTileBuildMs = 0;
    if (picture) {
      if (
        tileCacheEnabled &&
        zoom * dpr <= CANVASKIT_TILE_CACHE.maxPhysicalScale &&
        drawTiles(target, pan, zoom)
      )
        lastMode = "gpu-tiles";
      else target.drawPicture(picture);
    }
    target.restore();
    surface.flush();
    lastRenderMs = now() - started;
    frames++;
  }

  function stats() {
    return {
      renderer: "canvaskit",
      version: CANVASKIT_VERSION,
      backend: "WebGL2",
      gpuRenderer,
      ...sceneStats,
      pictureBuilds: builds,
      sceneRevision,
      resourceBuilds,
      nodePictureBuilds,
      nodePictureHits,
      textQualityBuilds: qualityBuilds,
      deviceTextSamplingBuilds: deviceSamplingBuilds,
      nodePictureCacheBytes: nodePictureBytes,
      nodePictureCacheBudgetBytes: MAX_NODE_PICTURE_BYTES,
      renderMode: lastMode,
      tileCacheEntries: tileCache.size,
      tileCacheBytes: tileBytes,
      tileCacheBudget: CANVASKIT_TILE_CACHE,
      tileBuilds,
      tileHits,
      tileEvictions,
      lastTileCount,
      lastTileSubmitMs: lastTileBuildMs,
      renderedFrames: frames,
      setSceneMs: lastSetSceneMs,
      lastRenderSubmitMs: lastRenderMs,
      timingScope: "CPU drawPicture + flush submission; excludes GPU completion/presentation",
      viewport: { width: cssWidth, height: cssHeight, dpr },
      wasmHeapBytes: CK.HEAPU8.buffer.byteLength,
      disposed,
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation++;
    releaseScene();
    surface?.delete();
    surface = null;
    context.releaseResourcesAndAbandonContext();
    context.delete();
    CK.deleteContext(contextHandle);
  }
  return { setScene, resize, render, dispose, stats };
}
