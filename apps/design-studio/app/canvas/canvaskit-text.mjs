import { designFillPaints, gradientMatrix } from "../paint.mjs";
import { designFontFamilyCss } from "../font-css.mjs";
import { currentTextMetrics } from "../text-metrics.mjs";

const rgba = (hex, alpha = 1) =>
  `rgba(${[1, 3, 5].map((p) => parseInt(hex.slice(p, p + 2), 16)).join(",")},${alpha})`;
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
  unsupportedNode,
  counters,
  makePaint,
}) {
  const provider = CK.TypefaceFontProvider.Make(),
    faces = new Map(),
    domFaces = [],
    owned = [];
  const fontPrefix = `ck-font-${++fontSequence}`;
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) {
    provider.delete();
    throw new Error("Browser text measurement unavailable");
  }
  let maxWidthDelta = 0,
    nativeMissingGlyphs = 0,
    unrenderedTextLines = 0;
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

  function rasterLine(canvas, node, line, y, alias) {
    configure(node, alias);
    const bounds = measure.measureText(line || " ");
    const left = Math.min(0, -bounds.actualBoundingBoxLeft),
      top = -bounds.actualBoundingBoxAscent;
    const right = Math.max(bounds.width, bounds.actualBoundingBoxRight),
      bottom = bounds.actualBoundingBoxDescent;
    const padding = Math.ceil((node.strokeWidth || 0) + 3),
      scale = 2;
    const w = Math.max(1, Math.ceil((right - left + padding * 2) * scale));
    const h = Math.max(1, Math.ceil((bottom - top + padding * 2) * scale));
    if (w > 8192 || h > 8192 || w * h > 4 * 1024 * 1024) {
      unsupportedNode(
        node,
        "raster-text-budget",
        "System-font text exceeds the bounded per-line raster budget",
      );
      unrenderedTextLines++;
      return;
    }
    const raster = document.createElement("canvas");
    raster.width = w;
    raster.height = h;
    const ctx = raster.getContext("2d", { willReadFrequently: true });
    ctx.scale(scale, scale);
    ctx.translate(-left + padding, -top + padding);
    ctx.font = measure.font;
    ctx.textBaseline = "hanging";
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${node.letterSpacing || 0}px`;
    const x = alignedX(node, bounds.width);
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
    const image = CK.MakeImage(
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
      unsupportedNode(node, "raster-text-decode", "Cannot create Skia text image");
      unrenderedTextLines++;
      return;
    }
    owned.push(image);
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

  function draw(canvas, node) {
    const entry = faces.get(node.fontRef) ?? faces.get(node.fontFamily);
    const lines = String(node.text).split("\n"),
      metrics = currentTextMetrics(node);
    counters.textLines += lines.length;
    if (!entry) {
      counters.rasterTextNodes++;
      unsupportedNode(
        node,
        "native-font-unavailable",
        `No font bytes for ${node.fontFamily}; browser same-family text raster fallback at 2x`,
      );
      if (!browserFamilyAvailable(node)) {
        unsupportedNode(
          node,
          "browser-font-unavailable",
          `The browser has no available ${node.fontFamily}; text is not silently substituted`,
        );
        unrenderedTextLines += lines.length;
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
      nativeMissingGlyphs += missing;
      counters.rasterTextNodes++;
      unsupportedNode(
        node,
        "native-missing-glyph",
        `${missing} glyphs absent from supplied font; browser same-family fallback at 2x`,
      );
      lines.forEach((line, i) =>
        rasterLine(canvas, node, line, node.y + i * node.fontSize * node.lineHeight, entry.alias),
      );
      return;
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
        const paint = makePaint(node, fill, { x, y });
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
    stats: () => ({
      loadedFontResources: faces.size,
      nativeMissingGlyphs,
      unrenderedTextLines,
      maxNativeTextWidthDelta: maxWidthDelta,
      rasterTextScale: 2,
      rasterTextImages: owned.length,
    }),
    dispose() {
      for (const image of owned) image.delete();
      for (const { face } of faces.values()) face.delete();
      for (const face of domFaces) document.fonts.delete(face);
      provider.delete();
    },
  };
}
