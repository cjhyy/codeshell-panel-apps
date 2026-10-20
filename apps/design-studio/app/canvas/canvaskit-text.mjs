import { designFillPaints, gradientMatrix } from "../paint.mjs";
import { designFontFamilyCss } from "../font-css.mjs";
import { currentTextMetrics } from "../text-metrics.mjs";

const rgba = (hex, alpha = 1) =>
  ["transparent", "none"].includes(hex)
    ? "rgba(0,0,0,0)"
    : `rgba(${[1, 3, 5].map((p) => parseInt(hex.slice(p, p + 2), 16)).join(",")},${alpha})`;
const weightKey = (n) =>
  n >= 900
    ? "Black"
    : n >= 800
      ? "ExtraBold"
      : n >= 700
        ? "Bold"
        : n >= 600
          ? "SemiBold"
          : n >= 500
            ? "Medium"
            : n >= 400
              ? "Normal"
              : n >= 300
                ? "Light"
                : n >= 200
                  ? "ExtraLight"
                  : "Thin";
let fontSequence = 0;

export async function createCanvasKitText({
  CK,
  design,
  resources,
  document,
  fallbackFontUrls,
  unsupportedNode: initialUnsupportedNode,
  counters: initialCounters,
  makePaint,
}) {
  const provider = CK.TypefaceFontProvider.Make(),
    faces = new Map(),
    domFaces = [];
  let counters = initialCounters,
    unsupportedNode = initialUnsupportedNode;
  let currentNodes = new Map(design.nodes.map((node) => [node.id, node]));
  const rasterImages = new Map(),
    rasterPlans = new Map(),
    contentBoundsCache = new Map(),
    missingByNode = new Map(),
    unrenderedByNode = new Map();
  const maxRasterPixels = 16 * 1024 * 1024;
  let rasterPixels = 0,
    rasterHits = 0,
    rasterMisses = 0,
    rasterUse = 0;
  const fontPrefix = `ck-font-${++fontSequence}`;
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) {
    provider.delete();
    throw new Error("Browser text measurement unavailable");
  }
  let maxWidthDelta = 0;
  const descriptors = new Map((design.resources ?? []).map((r) => [r.id, r]));
  const urlFonts =
    fallbackFontUrls instanceof Map ? fallbackFontUrls : new Map(Object.entries(fallbackFontUrls));
  const fetched = new Map();
  try {
    for (const node of design.nodes.filter((n) => n.type === "text")) {
      if (!node.fontRef && urlFonts.has(node.fontFamily) && !fetched.has(node.fontFamily)) {
        const url = new URL(urlFonts.get(node.fontFamily), document.baseURI);
        if (url.origin !== new URL(document.baseURI).origin)
          throw new Error("Fallback fonts must be same-origin local assets");
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Cannot load supplied font ${node.fontFamily}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 16 * 1024 * 1024)
          throw new Error("Fallback font exceeds the bounded asset budget");
        fetched.set(node.fontFamily, {
          bytes,
          descriptor: {
            family: node.fontFamily,
            weight: node.fontWeight,
            style: node.fontStyle || "normal",
          },
        });
      }
    }
    for (const [id, resource] of [...resources, ...fetched]) {
      const descriptor = resource.descriptor ?? descriptors.get(id);
      if (
        descriptor?.kind !== "font" &&
        !resource.mimeType?.startsWith("font/") &&
        !fetched.has(id)
      )
        continue;
      const face = CK.Typeface.MakeFreeTypeFaceFromData(resource.bytes);
      if (!face) continue;
      const alias = `${fontPrefix}-${faces.size}`;
      provider.registerFont(resource.bytes, alias);
      faces.set(id, { face, alias });
      const domFace = new FontFace(alias, resource.bytes, {
        weight: "1 1000",
        style: descriptor.style || "normal",
      });
      await domFace.load();
      document.fonts.add(domFace);
      domFaces.push(domFace);
    }
    await document.fonts.ready;
  } catch (error) {
    for (const { face } of faces.values()) face.delete();
    for (const face of domFaces) document.fonts.delete(face);
    provider.delete();
    throw error;
  }

  function configure(node, alias) {
    measure.font = `${node.fontStyle || "normal"} ${node.fontWeight} ${node.fontSize}px ${designFontFamilyCss(alias ?? node.fontFamily)}`;
    measure.textBaseline = "hanging";
    measure.textAlign = "left";
    // Canvas "auto" can disable pairs that the editable SVG text still kerns.
    if ("fontKerning" in measure) measure.fontKerning = "normal";
    if ("letterSpacing" in measure) measure.letterSpacing = `${node.letterSpacing || 0}px`;
  }
  function hangingOffset(node, alias) {
    configure(node, alias);
    const hanging = measure.measureText("Hg");
    measure.textBaseline = "alphabetic";
    const alphabetic = measure.measureText("Hg");
    measure.textBaseline = "hanging";
    return alphabetic.actualBoundingBoxAscent - hanging.actualBoundingBoxAscent;
  }
  const availableFamilies = new Map();
  function browserFamilyAvailable(node) {
    if (availableFamilies.has(node.fontFamily)) return availableFamilies.get(node.fontFamily);
    const probe = `abcdefghijklmnopqrstuvwxyzMW0123456789 ${String(node.text).slice(0, 128)}`;
    const available = ["monospace", "sans-serif", "serif"].some((generic) => {
      measure.font = `72px ${generic}`;
      const baseline = measure.measureText(probe).width;
      measure.font = `72px ${designFontFamilyCss(node.fontFamily)}, ${generic}`;
      return Math.abs(measure.measureText(probe).width - baseline) > 0.01;
    });
    availableFamilies.set(node.fontFamily, available);
    return available;
  }
  const alignedX = (node, width) =>
    node.x +
    (node.textAlign === "center"
      ? (node.width - width) / 2
      : node.textAlign === "right"
        ? node.width - width
        : 0);

  function rasterBounds(node, line, scale, alias) {
    configure(node, alias);
    const bounds = measure.measureText(line || " ");
    const left = Math.min(0, -bounds.actualBoundingBoxLeft),
      top = -bounds.actualBoundingBoxAscent;
    const right = Math.max(bounds.width, bounds.actualBoundingBoxRight),
      bottom = bounds.actualBoundingBoxDescent;
    const padding = Math.ceil((node.strokeWidth || 0) + 3);
    const w = Math.max(1, Math.ceil((right - left + padding * 2) * scale));
    const h = Math.max(1, Math.ceil((bottom - top + padding * 2) * scale));
    if (w > 8192 || h > 8192 || w * h > 4 * 1024 * 1024)
      throw new Error(
        `System-font text exceeds the bounded per-line raster budget at ${scale}x (${node.id})`,
      );
    return { bounds, left, top, bottom, padding, w, h };
  }
  function estimatePixels(node, scale, alias) {
    return String(node.text)
      .split("\n")
      .reduce((sum, line) => {
        const { w, h } = rasterBounds(node, line, scale, alias);
        return sum + w * h;
      }, 0);
  }
  function dropNodeImages(id) {
    for (const [key, entry] of rasterImages)
      if (entry.nodeId === id) {
        entry.image.delete();
        rasterPixels -= entry.pixels;
        rasterImages.delete(key);
      }
  }
  function rasterScaleForNode(node) {
    return rasterPlans.get(node.id)?.scale ?? 2;
  }
  const rasterSignature = (node, alias) =>
    JSON.stringify([
      node.text,
      node.fontRef,
      node.fontFamily,
      node.fontSize,
      node.fontWeight,
      node.fontStyle,
      node.lineHeight,
      node.letterSpacing,
      node.textAlign,
      node.textDecoration,
      node.width,
      node.height,
      node.fill,
      node.fillPaints,
      node.stroke,
      node.strokeWidth,
      alias,
    ]);
  function prepareRasterPlan(node, alias) {
    const signature = rasterSignature(node, alias);
    let plan = rasterPlans.get(node.id);
    if (!plan || plan.signature !== signature) {
      const scale = 2;
      dropNodeImages(node.id);
      plan = {
        node,
        alias,
        signature,
        scale,
        pixels: estimatePixels(node, scale, alias),
        used: ++rasterUse,
      };
      rasterPlans.set(node.id, plan);
    }
    return plan;
  }
  function setRasterScale(
    requestedScale,
    { visibleNodeIds = new Set(), nodeScales = new Map() } = {},
  ) {
    if (!Number.isFinite(requestedScale) || requestedScale <= 0)
      throw new Error("Invalid system-text raster scale");
    const changes = new Map();
    let total = [...rasterPlans.values()].reduce((sum, plan) => sum + plan.pixels, 0);
    for (const id of visibleNodeIds) {
      const plan = rasterPlans.get(id);
      const required = nodeScales.get(id) ?? requestedScale;
      const desired = Math.max(2, 2 ** Math.ceil(Math.log2(required)));
      if (!plan || plan.scale >= desired) continue;
      const pixels = estimatePixels(plan.node, desired, plan.alias);
      changes.set(id, { scale: desired, pixels });
      total += pixels - plan.pixels;
    }
    if (!changes.size) return false;
    const cold = [...rasterPlans]
      .filter(([id, plan]) => !visibleNodeIds.has(id) && plan.scale > 2)
      .sort((a, b) => a[1].used - b[1].used);
    for (const [id, plan] of cold) {
      if (total <= maxRasterPixels) break;
      const pixels = estimatePixels(plan.node, 2, plan.alias);
      changes.set(id, { scale: 2, pixels });
      total += pixels - plan.pixels;
    }
    if (total > maxRasterPixels)
      throw new Error("Visible system-font text exceeds the bounded high-resolution raster budget");
    for (const [id, change] of changes) {
      const plan = rasterPlans.get(id);
      dropNodeImages(id);
      Object.assign(plan, change, { used: ++rasterUse });
    }
    return true;
  }
  function beginScene(nextDesign) {
    const nodes = nextDesign.pages?.length
      ? nextDesign.pages.flatMap((page) =>
          page.id === nextDesign.activePageId ? nextDesign.nodes : (page.nodes ?? []),
        )
      : nextDesign.nodes;
    const contentChanged = nodes.some(
      (node) =>
        node.type === "text" &&
        rasterSignature(node) !== rasterSignature(currentNodes.get(node.id) ?? {}),
    );
    currentNodes = new Map(nodes.map((node) => [node.id, node]));
    for (const [id, plan] of rasterPlans)
      if (currentNodes.get(id)?.type !== "text") {
        dropNodeImages(id);
        rasterPlans.delete(id);
      } else if (plan.signature !== rasterSignature(currentNodes.get(id), plan.alias)) {
        // A content edit can make the previous high-quality line exceed the
        // budget even after it moves offscreen. Start the revision at 2x;
        // render() upgrades only text needed by the new viewport.
        dropNodeImages(id);
        rasterPlans.delete(id);
      }
    if (contentChanged)
      for (const [id, plan] of rasterPlans)
        if (plan.scale > 2) {
          // Reserve the baseline for edited/new lines before retaining optional
          // high-quality images. The next render reselects visible quality.
          dropNodeImages(id);
          plan.scale = 2;
          plan.pixels = estimatePixels(plan.node, 2, plan.alias);
        }
    for (const [id] of contentBoundsCache)
      if (currentNodes.get(id)?.type !== "text") contentBoundsCache.delete(id);
    for (const [id] of missingByNode)
      if (currentNodes.get(id)?.type !== "text") missingByNode.delete(id);
    for (const [id] of unrenderedByNode)
      if (currentNodes.get(id)?.type !== "text") unrenderedByNode.delete(id);
  }
  function contentBounds(node) {
    const signature = JSON.stringify(node),
      cached = contentBoundsCache.get(node.id);
    if (cached?.signature === signature) return cached.bounds;
    const entry = faces.get(node.fontRef) ?? faces.get(node.fontFamily);
    configure(node, entry?.alias);
    let left = node.x,
      right = node.x + node.width,
      top = node.y,
      bottom = node.y + node.height;
    String(node.text)
      .split("\n")
      .forEach((line, i) => {
        const metric = measure.measureText(line || " "),
          x = alignedX(node, metric.width);
        const y = node.y + i * node.fontSize * node.lineHeight;
        left = Math.min(left, x - metric.actualBoundingBoxLeft);
        right = Math.max(right, x + metric.width, x + metric.actualBoundingBoxRight);
        top = Math.min(top, y - metric.actualBoundingBoxAscent);
        bottom = Math.max(bottom, y + metric.actualBoundingBoxDescent);
      });
    // SkParagraph and browser shaping can differ slightly; preserve the whole
    // glyph/decoration extent without making every text picture page-sized.
    const bounds = {
      x: left - node.fontSize,
      y: top - node.fontSize,
      width: right - left + node.fontSize * 2,
      height: bottom - top + node.fontSize * 2,
    };
    contentBoundsCache.set(node.id, { signature, bounds });
    return bounds;
  }

  function rasterLine(canvas, node, line, y, alias) {
    const plan = prepareRasterPlan(node, alias),
      scale = plan.scale;
    const { bounds, left, top, bottom, padding, w, h } = rasterBounds(node, line, scale, alias);
    const x = alignedX(node, bounds.width);
    const cacheKey = JSON.stringify([node.id, plan.signature, line, y, scale]);
    let image = rasterImages.get(cacheKey)?.image;
    if (!image) {
      if (rasterPixels + w * h > maxRasterPixels)
        throw new Error("System-font text exceeds the bounded scene raster budget");
      const raster = document.createElement("canvas");
      raster.width = w;
      raster.height = h;
      const ctx = raster.getContext("2d", { willReadFrequently: true });
      ctx.scale(scale, scale);
      ctx.translate(-left + padding, -top + padding);
      ctx.font = measure.font;
      ctx.textBaseline = "hanging";
      if ("fontKerning" in ctx) ctx.fontKerning = "normal";
      if ("letterSpacing" in ctx) ctx.letterSpacing = `${node.letterSpacing || 0}px`;
      for (const fill of designFillPaints(node)) {
        if (fill.type === "SOLID") ctx.fillStyle = rgba(fill.color, fill.opacity);
        else {
          counters.gradientPaints++;
          const [[a, b, c], [d, e, f]] = gradientMatrix(fill.handles);
          ctx.save();
          ctx.transform(
            node.width * a,
            node.height * d,
            node.width * b,
            node.height * e,
            node.x - x + node.width * c,
            node.y - y + node.height * f,
          );
          const gradient = ctx.createLinearGradient(0, 0.5, 1, 0.5);
          ctx.restore();
          for (const stop of fill.stops)
            gradient.addColorStop(stop.position, rgba(stop.color, stop.opacity * fill.opacity));
          ctx.fillStyle = gradient;
        }
        ctx.fillText(line || " ", 0, 0);
      }
      if (node.strokeWidth > 0 && !["none", "transparent"].includes(node.stroke)) {
        ctx.strokeStyle = node.stroke;
        ctx.lineWidth = node.strokeWidth;
        ctx.strokeText(line || " ", 0, 0);
      }
      if (node.textDecoration && node.textDecoration !== "none") {
        ctx.strokeStyle = node.fill;
        ctx.lineWidth = Math.max(1, node.fontSize / 16);
        const decorationY =
          node.textDecoration === "underline" ? bottom + node.fontSize / 16 : (top + bottom) / 2;
        ctx.beginPath();
        ctx.moveTo(0, decorationY);
        ctx.lineTo(bounds.width, decorationY);
        ctx.stroke();
      }
      image = CK.MakeImage(
        {
          width: w,
          height: h,
          colorType: CK.ColorType.RGBA_8888,
          alphaType: CK.AlphaType.Unpremul,
          colorSpace: CK.ColorSpace.SRGB,
        },
        ctx.getImageData(0, 0, w, h).data,
        w * 4,
      );
      if (!image) {
        throw new Error("Cannot create GPU-renderable system-text image");
      }
      rasterImages.set(cacheKey, { image, nodeId: node.id, pixels: w * h });
      rasterPixels += w * h;
      rasterMisses++;
    } else rasterHits++;
    plan.used = ++rasterUse;
    const paint = new CK.Paint();
    canvas.drawImageRectOptions(
      image,
      CK.XYWHRect(0, 0, w, h),
      CK.XYWHRect(x + left - padding, y + top - padding, w / scale, h / scale),
      CK.FilterMode.Linear,
      CK.MipmapMode.None,
      paint,
    );
    paint.delete();
  }

  function draw(canvas, node, nextCounters = counters, nextUnsupported = unsupportedNode) {
    counters = nextCounters;
    unsupportedNode = nextUnsupported;
    missingByNode.delete(node.id);
    unrenderedByNode.delete(node.id);
    const entry = faces.get(node.fontRef) ?? faces.get(node.fontFamily);
    const lines = String(node.text).split("\n"),
      metrics = currentTextMetrics(node);
    counters.textLines += lines.length;
    if (!entry) {
      counters.rasterTextNodes++;
      unsupportedNode(
        node,
        "native-font-unavailable",
        `No font bytes for ${node.fontFamily}; browser same-family text raster cache`,
      );
      if (!browserFamilyAvailable(node)) {
        unsupportedNode(
          node,
          "browser-font-unavailable",
          `The browser has no available ${node.fontFamily}; text is not silently substituted`,
        );
        unrenderedByNode.set(node.id, lines.length);
        return;
      }
      lines.forEach((line, i) =>
        rasterLine(canvas, node, line, node.y + i * node.fontSize * node.lineHeight),
      );
      return;
    }
    const probe = new CK.Font(entry.face, node.fontSize);
    const glyphs = probe.getGlyphIDs(
      node.text.replaceAll("\n", ""),
      [...node.text.replaceAll("\n", "")].length,
    );
    const missing = [...glyphs].filter((glyph) => glyph === 0).length;
    probe.delete();
    if (missing) {
      missingByNode.set(node.id, missing);
      counters.rasterTextNodes++;
      unsupportedNode(
        node,
        "native-missing-glyph",
        `${missing} glyphs absent from supplied font; browser same-family raster cache`,
      );
      lines.forEach((line, i) =>
        rasterLine(canvas, node, line, node.y + i * node.fontSize * node.lineHeight, entry.alias),
      );
      return;
    }
    if (rasterPlans.has(node.id)) {
      dropNodeImages(node.id);
      rasterPlans.delete(node.id);
    }
    counters.nativeTextNodes++;
    const baseline = hangingOffset(node, entry.alias);
    lines.forEach((line, i) => {
      const style = new CK.TextStyle({
        fontFamilies: [entry.alias],
        fontSize: node.fontSize,
        fontStyle: {
          weight: CK.FontWeight[weightKey(node.fontWeight)],
          width: CK.FontWidth.Normal,
          slant: node.fontStyle === "italic" ? CK.FontSlant.Italic : CK.FontSlant.Upright,
        },
        fontVariations: [{ axis: "wght", value: node.fontWeight }],
        letterSpacing: node.letterSpacing || 0,
        decoration:
          node.textDecoration === "underline"
            ? CK.UnderlineDecoration
            : node.textDecoration === "line-through"
              ? CK.LineThroughDecoration
              : CK.NoDecoration,
      });
      const fills = [...designFillPaints(node)];
      if (node.strokeWidth > 0 && !["none", "transparent"].includes(node.stroke))
        fills.push({ type: "SOLID", color: node.stroke, opacity: 1, stroke: true });
      let x, y;
      for (const fill of fills) {
        if (fill.type === "GRADIENT_LINEAR") counters.gradientPaints++;
        // First shape without a shader to obtain accurate width and alphabetic baseline.
        const measureBuilder = CK.ParagraphBuilder.MakeFromFontProvider(
          new CK.ParagraphStyle({ textStyle: style, maxLines: 1 }),
          provider,
        );
        measureBuilder.addText(line || " ");
        const shape = measureBuilder.build();
        measureBuilder.delete();
        shape.layout(1048576);
        const width = shape.getLongestLine();
        x = alignedX(node, width);
        y = node.y + i * node.fontSize * node.lineHeight + baseline - shape.getAlphabeticBaseline();
        shape.delete();
        if (metrics)
          maxWidthDelta = Math.max(maxWidthDelta, Math.abs(width - metrics.lineWidths[i]));
        // SkParagraph positions glyphs in the destination canvas coordinates;
        // its foreground shader must use the same world coordinates as shapes.
        const paint = makePaint(node, fill);
        if (fill.stroke) {
          paint.setStyle(CK.PaintStyle.Stroke);
          paint.setStrokeWidth(node.strokeWidth);
        }
        const builder = CK.ParagraphBuilder.MakeFromFontProvider(
          new CK.ParagraphStyle({ textStyle: style, maxLines: 1 }),
          provider,
        );
        const background = new CK.Paint();
        background.setAlphaf(0);
        builder.pushPaintStyle(style, paint, background);
        builder.addText(line || " ");
        const paragraph = builder.build();
        paragraph.layout(1048576);
        canvas.drawParagraph(paragraph, x, y);
        paragraph.delete();
        builder.delete();
        background.delete();
        paint.delete();
      }
    });
  }
  return {
    draw,
    beginScene,
    setRasterScale,
    rasterScaleForNode,
    contentBounds,
    stats: () => ({
      loadedFontResources: faces.size,
      nativeMissingGlyphs: [...missingByNode.values()].reduce((sum, value) => sum + value, 0),
      unrenderedTextLines: [...unrenderedByNode.values()].reduce((sum, value) => sum + value, 0),
      maxNativeTextWidthDelta: maxWidthDelta,
      rasterTextScale: Math.max(2, ...[...rasterPlans.values()].map((plan) => plan.scale)),
      rasterTextImages: rasterImages.size,
      rasterTextCacheBytes: rasterPixels * 4,
      rasterTextCacheBudgetBytes: maxRasterPixels * 4,
      rasterTextCacheHits: rasterHits,
      rasterTextCacheMisses: rasterMisses,
      rasterNodeScales: [...rasterPlans].map(([nodeId, plan]) => ({ nodeId, scale: plan.scale })),
    }),
    dispose() {
      for (const entry of rasterImages.values()) entry.image.delete();
      rasterImages.clear();
      rasterPlans.clear();
      contentBoundsCache.clear();
      rasterPixels = 0;
      for (const { face } of faces.values()) face.delete();
      for (const face of domFaces) document.fonts.delete(face);
      provider.delete();
    },
  };
}
