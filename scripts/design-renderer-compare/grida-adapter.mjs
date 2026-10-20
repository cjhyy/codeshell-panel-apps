/* Experimental native Grida scene adapter; isolated from the installed Panel. */
import { designFontFamilyCss } from "../../apps/design-studio/app/font-css.mjs";
import { inverseGradientMatrix } from "../../apps/design-studio/app/paint.mjs";
import { measuredTextInkBounds } from "../../apps/design-studio/app/text-metrics.mjs";
import { GRIDA_ENCODER_SOURCE_COMMIT, gridaImageResourceId, rgba, toGridaDocument } from "./grida-scene.mjs";

export const GRIDA_PACKAGE = Object.freeze({
  name: "@grida/canvas-wasm", version: "0.91.0-canary.22", license: "Apache-2.0",
  integrity: "sha512-w+jjgAqWV/zj21RG2BKqMvdddiZLT5ONSFOQSFwMhq++AGcY5glLYTkX4ga8fTqViiufLBZTXE4NNPDWDjA8Hg==",
  wasmBytes: 17_623_372,
  wasmSha256: "de9ea26c673238392cc48beeaa9962999d23fda2a8d46f229ecac8f67a1e085d",
});

const cssColor = (value, opacity = 1) => {
  const color = rgba(value, opacity);
  return `rgba(${color.r * 255},${color.g * 255},${color.b * 255},${color.a})`;
};
function textPaint(context, node, paint) {
  if (paint.type === "SOLID") return cssColor(paint.color);
  // A general affine gradient's first inverse row is its scalar color parameter.
  const [a, b, c] = inverseGradientMatrix(paint.handles)[0];
  const x = a / node.width, y = b / node.height, length = x * x + y * y;
  const gradient = context.createLinearGradient(-c * x / length, -c * y / length,
    (1 - c) * x / length, (1 - c) * y / length);
  for (const stop of paint.stops) gradient.addColorStop(stop.position, cssColor(stop.color, stop.opacity));
  return gradient;
}

async function rasterText(node, scale) {
  const ink = measuredTextInkBounds(node) ?? { x: 0, y: 0, width: node.width, height: node.height };
  const stroke = node.stroke !== "transparent" ? node.strokeWidth / 2 : 0;
  const shadow = node.shadow?.opacity > 0 ? node.shadow : null;
  const blur = shadow ? shadow.blur * 1.5 : 0;
  // These are text-local offsets. The original text node remains as its parent,
  // retaining its own transform, opacity and source ID in the native scene.
  const left = Math.floor(Math.min(0, ink.x) - stroke - blur - Math.max(0, -(shadow?.x ?? 0)) - 1);
  const top = Math.floor(Math.min(0, ink.y) - stroke - blur - Math.max(0, -(shadow?.y ?? 0)) - 1);
  const width = Math.ceil(Math.max(node.width, ink.x + ink.width) + stroke + blur + Math.max(0, shadow?.x ?? 0) + 1 - left);
  const height = Math.ceil(Math.max(node.height, ink.y + ink.height) + stroke + blur + Math.max(0, shadow?.y ?? 0) + 1 - top);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  if (canvas.width * canvas.height > 8_000_000 || Math.max(canvas.width, canvas.height) > 16384)
    throw Error(`Text raster cache budget exceeded for ${node.id}`);
  const context = canvas.getContext("2d");
  if (!context) throw Error("Canvas2D is unavailable for system-font text fallback");
  context.scale(scale, scale);
  context.translate(-left, -top);
  context.font = `${node.fontStyle ?? "normal"} ${node.fontWeight} ${node.fontSize}px ${designFontFamilyCss(node.fontFamily)}`;
  context.textBaseline = "hanging";
  context.textAlign = node.textAlign;
  if ("letterSpacing" in context) context.letterSpacing = `${node.letterSpacing ?? 0}px`;
  else if (node.letterSpacing) throw Error(`Canvas2D cannot preserve letter spacing for ${node.id}`);
  const x = node.textAlign === "center" ? node.width / 2 : node.textAlign === "right" ? node.width : 0;
  const lines = String(node.text).split("\n");
  const paints = node.fillPaints ?? [{ type: "SOLID", color: node.fill, opacity: 1 }];
  for (const paint of paints) {
    context.fillStyle = textPaint(context, node, paint);
    context.globalAlpha = paint.opacity;
    lines.forEach((line, index) => context.fillText(line, x, index * node.fontSize * node.lineHeight));
  }
  context.globalAlpha = 1;
  if (node.stroke !== "transparent" && node.strokeWidth > 0) {
    context.strokeStyle = cssColor(node.stroke); context.lineWidth = node.strokeWidth;
    lines.forEach((line, index) => context.strokeText(line, x, index * node.fontSize * node.lineHeight));
  }
  if (node.textDecoration && node.textDecoration !== "none") {
    context.fillStyle = textPaint(context, node, paints[0]);
    context.globalAlpha = paints[0].opacity;
    lines.forEach((line, index) => {
      const advance = context.measureText(line).width;
      const lineX = x - (node.textAlign === "center" ? advance / 2 : node.textAlign === "right" ? advance : 0);
      const lineY = index * node.fontSize * node.lineHeight;
      const offset = node.textDecoration === "underline" ? node.fontSize * 0.9 : node.fontSize * 0.42;
      context.fillRect(lineX, lineY + offset, advance, Math.max(1, node.fontSize / 16));
    });
  }
  let raster = canvas;
  if (shadow) {
    raster = document.createElement("canvas");
    raster.width = canvas.width; raster.height = canvas.height;
    const output = raster.getContext("2d");
    if (!output) throw Error("Canvas2D is unavailable for text shadow fallback");
    output.shadowColor = cssColor(shadow.color, shadow.opacity);
    output.shadowOffsetX = shadow.x * scale; output.shadowOffsetY = shadow.y * scale;
    output.shadowBlur = shadow.blur * scale;
    output.drawImage(canvas, 0, 0);
  }
  const blob = await new Promise((resolve, reject) => raster.toBlob(
    (value) => value ? resolve(value) : reject(Error(`Text PNG encoding failed for ${node.id}`)), "image/png"));
  return { x: left, y: top, width, height, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

export async function createRenderer({ canvas, assetsBaseUrl }) {
  if (!canvas?.getContext) throw Error("Grida renderer requires an HTML canvas");
  const base = new URL(assetsBaseUrl.endsWith("/") ? assetsBaseUrl : `${assetsBaseUrl}/`, document.baseURI);
  const runtime = await import(new URL("grida-runtime.mjs", base).href);
  const init = runtime.init ?? runtime.default?.default ?? runtime.default;
  const version = runtime.version ?? runtime.default?.version;
  if (version !== GRIDA_PACKAGE.version || typeof init !== "function")
    throw Error(`Expected ${GRIDA_PACKAGE.name}@${GRIDA_PACKAGE.version}, received ${version}`);
  const encoder = await import(new URL("grida-encoder.mjs", base).href);
  if (typeof encoder.encode !== "function") throw Error("Grida FlatBuffers encoder is unavailable");
  const factory = await init({ locateFile: (file) => new URL(file, base).href });
  let scene = factory.createWebGLCanvasSurface(canvas, {
    use_embedded_fonts: false, config: { skip_layout: true },
  });
  let alive = true, generation = 0, hasScene = false, dpr = 1, snapshot = null, bootstrapFrame = 0;
  let camera = { pan: { x: 0, y: 0 }, zoom: 1 };
  let receipt = { backend: "Grida/Wasm/WebGL2", package: GRIDA_PACKAGE,
    encoderSourceCommit: GRIDA_ENCODER_SOURCE_COMMIT, encoderSchemaVersion: encoder.schemaVersion,
    hostFileBudgetExceeded: GRIDA_PACKAGE.wasmBytes > 16 * 1024 * 1024,
    initialized: true, sceneReady: false };
  const textCache = new Map();
  const assertAlive = () => { if (!alive) throw Error("Grida renderer is disposed"); };
  const paint = () => {
    // Grida receives a world-space camera pose; its view matrix inverts this
    // transform and then translates to the physical viewport center.
    const scale = camera.zoom * dpr;
    scene.setMainCameraTransform([[1 / scale, 0, (canvas.width / 2 - camera.pan.x * dpr) / scale],
      [0, 1 / scale, (canvas.height / 2 - camera.pan.y * dpr) / scale]]);
    scene.redraw(); scene.tick(performance.now());
  };
  const bootstrapPresentation = () => {
    if (bootstrapFrame) cancelAnimationFrame(bootstrapFrame);
    // A newly created native surface needs a subsequent clock tick to present
    // after its first pipeline setup. This bounded callback is only for scene
    // loading/resizing; ordinary camera updates remain caller-driven.
    bootstrapFrame = requestAnimationFrame(() => {
      bootstrapFrame = 0;
      if (alive) paint();
    });
  };
  return {
    async setScene(design, { resources = new Map() } = {}) {
      assertAlive();
      if (bootstrapFrame) cancelAnimationFrame(bootstrapFrame);
      bootstrapFrame = 0;
      const ticket = ++generation, start = performance.now();
      const check = () => { assertAlive(); if (ticket !== generation) throw Error("Grida scene preparation was superseded"); };
      if (hasScene) {
        scene.dispose();
        scene = factory.createWebGLCanvasSurface(canvas, { use_embedded_fonts: false,
          config: { skip_layout: true } });
      }
      snapshot = null;
      hasScene = true;
      const registered = new Set(), fontFiles = new Set(), fontFallbackReasons = new Map();
      const fontFailures = [], imageFailures = [], loadedFonts = [], loadedImages = [];
      let fontBytes = 0, imageBytes = 0;
      for (const [id, resource] of resources) {
        const descriptor = resource.descriptor ?? design.resources?.find((value) => value.id === id);
        if (descriptor?.kind !== "font") continue;
        const signature = String.fromCharCode(...resource.bytes.subarray(0, 4));
        if (signature === "wOF2" || signature === "wOFF")
          fontFallbackReasons.set(descriptor.family,
            `Pinned Grida silently accepts unsupported font decoding; ${descriptor.family} webfont glyphs are cached per text layer for fidelity.`);
        const key = `${descriptor.family}:${descriptor.sha256 ?? id}`;
        if (fontFiles.has(key)) continue;
        try {
          scene.addFont(descriptor.family, resource.bytes);
          loadedFonts.push({ family: descriptor.family, bytes: resource.bytes });
          fontBytes += resource.bytes.length; fontFiles.add(key);
        } catch (error) { fontFailures.push({ id, message: error.message }); }
      }
      for (const font of scene.listAvailableFonts()) registered.add(font.family);
      // The pinned build accepts the FA5 alias registration but renders the FA6
      // bundled PUA glyphs as tofu. Available/missing family lists do not detect
      // this glyph loss, so use the same browser glyphs as the SVG reference.
      for (const family of registered)
        if (family.startsWith("Font Awesome 5 ")) fontFallbackReasons.set(family,
          `Pinned Grida does not reliably render ${family} aliases; browser glyphs are cached per text layer.`);
      const fallbackFonts = [...registered].filter((family) => !family.includes("Font Awesome"));
      scene.setFallbackFonts(fallbackFonts);
      await document.fonts?.ready;
      check();
      let cacheHits = 0, decorationApproximations = 0;
      const projected = await toGridaDocument(design, { resources,
        registeredFontFamilies: registered, fontFallbackReasons,
        rasterizeText: async (node) => {
          const key = JSON.stringify([node.text, node.fontFamily, node.fontSize, node.fontWeight,
            node.fontStyle, node.lineHeight, node.letterSpacing, node.textAlign, node.width,
            node.height, node.fill, node.fillPaints, node.stroke, node.strokeWidth, node.textDecoration,
            node.shadow, Math.max(2, dpr)]);
          if (node.textDecoration && node.textDecoration !== "none") decorationApproximations += 1;
          if (!textCache.has(key)) textCache.set(key, await rasterText(node, Math.max(2, dpr)));
          else cacheHits += 1;
          check();
          return textCache.get(key);
        },
      });
      check();
      const encoded = encoder.encode(projected.document);
      scene.loadSceneGrida(encoded);
      scene.switchScene(projected.document.entry_scene_id);
      for (const [id, resource] of resources) {
        const descriptor = resource.descriptor ?? design.resources?.find((value) => value.id === id);
        if (descriptor?.kind !== "image") continue;
        const result = scene.addImageWithId(resource.bytes, gridaImageResourceId(id));
        if (result === false) imageFailures.push({ id, message: "Grida could not decode the supplied image" });
        else { imageBytes += resource.bytes.length;
          loadedImages.push({ id: gridaImageResourceId(id), bytes: resource.bytes }); }
      }
      for (const image of projected.images) {
        if (scene.addImageWithId(image.bytes, image.id) === false)
          throw Error(`Grida could not decode rasterized text ${image.id}`);
        imageBytes += image.bytes.length;
        loadedImages.push(image);
      }
      snapshot = { encoded, sceneId: projected.document.entry_scene_id,
        fonts: loadedFonts, images: loadedImages, fallbackFonts };
      paint();
      bootstrapPresentation();
      receipt = { ...receipt, ...projected.stats, sceneReady: true, sceneBinaryBytes: encoded.length,
        engineNodes: Object.keys(projected.document.nodes).length, fontBytes, imageBytes,
        registeredFontFamilies: [...registered], fontFailures, imageFailures,
        nativeFontValidationWarnings: [...fontFallbackReasons].map(([family, message]) => ({ family, message })),
        rasterNativeFontFallback: projected.stats.unsupported.filter((issue) => issue.code === "native-font-raster-cache").length,
        missingNativeFonts: scene.listMissingFonts(), missingImageRefs: scene.drainMissingImages(),
        rasterTextCacheEntries: textCache.size, rasterTextCacheHits: cacheHits,
        rasterTextDecorationApproximations: decorationApproximations,
        setSceneMs: performance.now() - start };
      return receipt;
    },
    resize(width, height, devicePixelRatio = 1) {
      assertAlive();
      if (![width, height, devicePixelRatio].every((value) => Number.isFinite(value) && value > 0))
        throw Error("Invalid Grida surface size");
      dpr = devicePixelRatio;
      const physicalWidth = Math.round(width * dpr), physicalHeight = Math.round(height * dpr);
      const changed = canvas.width !== physicalWidth || canvas.height !== physicalHeight;
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      if (!changed) return;
      canvas.width = physicalWidth; canvas.height = physicalHeight;
      if (snapshot) {
        // The pinned Grida surface stops presenting after a loaded WebGL
        // backing store is resized. Recreate it at the final physical size;
        // retain the prepared scene and resource bytes, without rerasterizing.
        const start = performance.now();
        scene.dispose();
        scene = factory.createWebGLCanvasSurface(canvas, { use_embedded_fonts: false,
          config: { skip_layout: true } });
        for (const font of snapshot.fonts) scene.addFont(font.family, font.bytes);
        scene.setFallbackFonts(snapshot.fallbackFonts);
        scene.loadSceneGrida(snapshot.encoded);
        scene.switchScene(snapshot.sceneId);
        for (const image of snapshot.images) scene.addImageWithId(image.bytes, image.id);
        receipt = { ...receipt, surfaceRebuilds: (receipt.surfaceRebuilds ?? 0) + 1,
          resizeRebuildMs: performance.now() - start };
        paint();
        bootstrapPresentation();
      } else scene.resize(canvas.width, canvas.height);
    },
    render(next = camera) {
      assertAlive();
      if (![next.pan?.x, next.pan?.y, next.zoom].every(Number.isFinite) || next.zoom <= 0)
        throw Error("Invalid Grida camera");
      camera = { pan: { ...next.pan }, zoom: next.zoom };
      paint();
    },
    dispose() {
      if (!alive) return;
      alive = false; generation += 1; scene.dispose(); textCache.clear();
      if (bootstrapFrame) cancelAnimationFrame(bootstrapFrame);
      bootstrapFrame = 0;
      snapshot = null;
      receipt = { ...receipt, disposed: true };
    },
    stats() { return structuredClone(receipt); },
  };
}
