/* Retained CanvasKit renderer. The document and editing state remain owned by Design Studio. */
import { effectiveDesignNodeOpacity, isDesignNodeVisible } from "../document.mjs";
import { designFillPaints, gradientMatrix } from "../paint.mjs";
import { createCanvasKitText } from "./canvaskit-text.mjs";

export const CANVASKIT_VERSION = "0.42.0";
const modules = new Map();
const MAX_PIXELS = 16 * 1024 * 1024;
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

function clipAncestors(CK, canvas, chain) {
  const prefix = [];
  for (const node of chain) {
    prefix.push(node);
    if (!["frame", "component"].includes(node.type) || !node.clipContent) continue;
    rotateChain(canvas, prefix);
    const radius = Math.min(node.cornerRadius || 0, node.width / 2, node.height / 2);
    canvas.clipRRect(CK.RRectXY(rect(CK, node), radius, radius), CK.ClipOp.Intersect, true);
    rotateChain(canvas, prefix, true);
  }
}

function drawShape(CK, canvas, node, paint) {
  if (node.type === "ellipse") canvas.drawOval(rect(CK, node), paint);
  else {
    const radius = Math.min(node.cornerRadius || 0, node.width / 2, node.height / 2);
    canvas.drawRRect(CK.RRectXY(rect(CK, node), radius, radius), paint);
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
}

/** resources are decoded bytes, never screenshots of the scene. Extra fonts are optional real font URLs. */
export async function createRenderer({
  canvas,
  assetsBaseUrl,
  fallbackFontUrls = {},
  background = "#ececea",
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
    owned = [];
  const assertLive = () => {
    if (disposed) throw new Error("CanvasKit renderer is disposed");
  };
  const releaseScene = () => {
    picture?.delete();
    picture = null;
    for (const value of owned.reverse()) value.delete?.();
    owned = [];
    sceneState?.dispose();
    sceneState = null;
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
    const nextOwned = [],
      images = new Map();
    const text = await createCanvasKitText({
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
      text.dispose();
      return;
    }
    let nextPicture;
    const recorder = new CK.PictureRecorder();
    try {
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
      // A generous cull rect permits out-of-artboard nodes/shadows without allocating a giant bitmap.
      // CanvasKit's computeBounds flag builds Skia's R-tree for viewport culling.
      const target = recorder.beginRecording(CK.LTRBRect(-100000, -100000, 100000, 100000), true);
      const background = new CK.Paint();
      background.setColor(canvasKitColor(CK, design.canvas.background));
      target.drawRect(CK.XYWHRect(0, 0, design.canvas.width, design.canvas.height), background);
      background.delete();

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
                unsupportedNode(node, "component-unavailable", "Missing or recursive component");
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
            if (node.type === "image") {
              const image = images.get(node.imageRef);
              if (image) drawImage(CK, target, node, image);
              else {
                if (resources.has(node.imageRef))
                  unsupportedNode(node, "image-decode", "Image bytes could not be decoded");
                counters.missingImages++;
                drawMissing(CK, target, node);
              }
              return;
            }
            if (node.type === "text") {
              text.draw(target, node);
              return;
            }
            if (!["rectangle", "frame", "component", "ellipse"].includes(node.type)) {
              unsupportedNode(node, "node-type", node.type);
              drawMissing(CK, target, node);
              return;
            }
            for (const fill of designFillPaints(node)) {
              if (fill.type === "GRADIENT_LINEAR") counters.gradientPaints++;
              const paint = makePaint(CK, node, fill);
              drawShape(CK, target, node, paint);
              paint.delete();
            }
            if (node.strokeWidth > 0 && !["none", "transparent"].includes(node.stroke)) {
              const stroke = new CK.Paint();
              stroke.setAntiAlias(true);
              stroke.setStyle(CK.PaintStyle.Stroke);
              stroke.setColor(canvasKitColor(CK, node.stroke));
              stroke.setStrokeWidth(node.strokeWidth);
              drawShape(CK, target, node, stroke);
              stroke.delete();
            }
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
      nextPicture = recorder.finishRecordingAsPicture();
      releaseScene();
      picture = nextPicture;
      nextPicture = null;
      owned = nextOwned;
      sceneState = text;
      builds++;
      lastSetSceneMs = now() - started;
      sceneStats = {
        ...counters,
        ...text.stats(),
        unsupported,
        unsupportedCount: unsupported.length,
        pictureBytes: picture.approximateBytesUsed(),
        canvas: { ...design.canvas },
      };
    } catch (error) {
      nextPicture?.delete();
      nextOwned.forEach((value) => value.delete());
      text.dispose();
      throw error;
    } finally {
      recorder.delete();
    }
  }

  function render({ pan = { x: 0, y: 0 }, zoom = 1 } = {}) {
    assertLive();
    if (!gl || gl.isContextLost())
      throw new Error("CanvasKit WebGL context lost; this frame was not rendered");
    if (![pan.x, pan.y, zoom].every(Number.isFinite) || zoom <= 0)
      throw new Error("Invalid viewport transform");
    const started = now(),
      target = surface.getCanvas();
    target.clear(canvasKitColor(CK, background));
    target.save();
    target.scale(dpr, dpr);
    target.translate(pan.x, pan.y);
    target.scale(zoom, zoom);
    if (picture) target.drawPicture(picture);
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
