import { textLineHeightPixels } from "../text-line-height.mjs";
import { textHasLineBoxOrigin, textLineBoxAlphabeticOffset, textLineBoxBaselineY, textLineBoxBaselineAt, textFiniteBaselineY, textHtmlFiniteLineBoxNode } from "../text-line-box.mjs";
import { designFillPaints, gradientMatrix } from "../paint.mjs";
import { designFontFamilyCss, designNamedFontFamilyCss, designResourceFontFamilyCss } from "../font-css.mjs";
import { currentTextMetrics, textDisplayLineMetrics } from "../text-metrics.mjs";
import { projectTextRanges, validateTextRanges, textRangeTypography } from "../text-ranges.mjs";
import { parseDesignFontFamily } from "../font-family.mjs";
import { inspectFontCapabilities, fontFaceWeight, fontWeightAxis, selectFontEntry } from "../font-capabilities.mjs";

export function canvasKitTextRangePlan(node, { suppliedFont = true, missingGlyphs = 0 } = {}) {
  const payload = validateTextRanges(node);
  if (!payload) return null;
  const refuse = (detail) => {
    const error = new Error(`TEXT_RANGES_UNSUPPORTED: ${String(node.id).slice(0, 100)} · ${detail}`);
    error.code = "TEXT_RANGES_UNSUPPORTED";
    throw error;
  };
  if (!suppliedFont || missingGlyphs)
    refuse("范围文字需要完整的已提供字体；浏览器逐段缓存不能保证整段塑形");
  if (node.fillPaints?.length || node.strokeWidth > 0 && !["none", "transparent"].includes(node.stroke))
    refuse("范围文字的多层填色或描边尚不能准确绘制");
  if (payload.ranges.some((range) => ["textDecorationThickness", "textUnderlineOffset", "textDecorationSkipInk"]
    .some((key) => Object.hasOwn(range, key))))
    refuse("范围下划线的自定义厚度、偏移或跳墨尚不能准确绘制；文字和样式已保留");
  return projectTextRanges(node);
}

/** Byte-proven native variation instances mirror CSS optical sizing. */
export function canvasKitTextFontVariations(node, style, capabilities) {
  const variations = fontWeightAxis(capabilities) ? [{ axis: "wght", value: style.fontWeight }] : [];
  // Imported hanging text and mixed typography retain their existing pixels.
  const optical = textHasLineBoxOrigin(node) && !textRangeTypography(node, false).length &&
    capabilities?.status === "verified" && capabilities.axes.find(axis => axis.tag === "opsz");
  if (optical) variations.push({ axis: "opsz", value: Math.min(optical.max, Math.max(optical.min, style.fontSize)) });
  return variations;
}

/** Ordinary line-box text can share the browser's loaded resource-font raster.
 * Imported finite origins and glyph/decoration semantics keep their native path. */
export function canvasKitResourceTextRasterEligible(node) {
  return textHasLineBoxOrigin(node) && node.textRanges === undefined &&
    !node.fillPaints?.length && !(node.strokeWidth > 0 && !["none", "transparent"].includes(node.stroke)) &&
    (!node.textDecoration || node.textDecoration === "none");
}

/**
 * Fill/link and typography (family, size, weight, italic) ranges can share the
 * browser same-family raster that plain text already uses: one Canvas2D shaping
 * per same-font run group, each fill clipped to its prefix-measured interval.
 * Auto underline and line-through are drawn from measured HTML models. Paint
 * stacks, strokes, custom decorations, bidi text and skip-ink underlines keep
 * the native paragraph path; finite text HTML lays out as a plain line box
 * arrives here already converted (textHtmlFiniteLineBoxNode).
 */
const RANGE_CUSTOM_DECORATION_KEYS = ["textDecorationThickness", "textUnderlineOffset", "textDecorationSkipInk"];
// Strong right-to-left characters: prefix-measured logical intervals would not be visual intervals.
// Supplementary planes: the RTL script areas U+10800-10FFF (Phoenician .. Yezidi) and U+1E800-1EFFF (Mende Kikakui, Adlam, ...).
const STRONG_RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc\u200f\u202b\u202e\u2067\u{10800}-\u{10fff}\u{1e800}-\u{1efff}]/u;
/** Why a ranged text node stays on the native paragraph path (null: it uses the range raster). */
export function canvasKitRangeTextRasterFallbackReason(node) {
  if (node?.type !== "text" || node.textRanges === undefined) return "no-ranges";
  if (node.fillPaints?.length || node.strokeWidth > 0 && !["none", "transparent"].includes(node.stroke)) return "paint-stack-or-stroke";
  let payload;
  try { payload = validateTextRanges(node); } catch { return "invalid-ranges"; }
  if (!payload) return "no-ranges";
  if (STRONG_RTL.test(String(node.text))) return "bidi";
  if (payload.ranges.some(range => RANGE_CUSTOM_DECORATION_KEYS.some(key => Object.hasOwn(range, key)))) return "decoration-custom";
  // Auto underline and line-through are modelled from measured HTML (rangeUnderline, rangeLineThrough), per run.
  // A node-level line-through over mixed typography would need the decorating box's metrics: not measured.
  if (node.textDecoration === "line-through" && textRangeTypography(node, false).length) return "line-through-mixed-typography";
  // Finite + typography: HTML lays it out as a plain line box (textHtmlFiniteHangingTransport), as does the raster.
  return null;
}
export function canvasKitRangeTextRasterEligible(node) {
  return canvasKitRangeTextRasterFallbackReason(node) === null;
}
const rangeUnsupported = (error) => error?.code === "TEXT_RANGES_UNSUPPORTED" || /^TEXT_RANGES_UNSUPPORTED:/u.test(String(error?.message ?? ""));

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
    fontFamilies = new Map(),
    aliasFamilies = new Map(),
    domFaces = [];
  let counters = initialCounters,
    unsupportedNode = initialUnsupportedNode;
  // Scene nodes as supplied (parents, rotation, constraints decide the HTML transport) and as drawn.
  let sceneNodes = new Map(design.nodes.map((node) => [node.id, node])), canvasMode = design.canvas?.mode;
  /** Finite text HTML does not carry at its hanging origin is drawn as the CSS line box HTML lays out. */
  function htmlLineBox(node) {
    if (node?.type !== "text" || textHasLineBoxOrigin(node)) return node;
    const scene = sceneNodes.get(node.id) ?? node;
    return textHtmlFiniteLineBoxNode(node, { parent: sceneNodes.get(scene.parentId) ?? null,
      infiniteRoot: !scene.parentId && canvasMode === "infinite" }, scene);
  }
  let currentNodes = new Map(design.nodes.map((node) => [node.id, htmlLineBox(node)]));
  const rangeNativeFallbacks = new Map();
  // Document layout zoom (blinkLayoutScale), set per scene by the renderer.
  let layoutScale = 1;
  const rasterImages = new Map(),
    rasterPlans = new Map(),
    devicePlans = new Map(),
    contentBoundsCache = new Map(),
    missingByNode = new Map(),
    unrenderedByNode = new Map();
  let activeDeviceIds = new Set(), deviceRequestKey = null, deviceEligibility = null;
  let deviceFallbacks = [];
  const maxRasterPixels = 16 * 1024 * 1024;
  // Optional rotated-shape images share this existing text raster budget.
  const shapeRasterReservations = new Map();
  let releaseShapeRasters = null;
  const shapeRasterPixels = () => [...shapeRasterReservations.values()].reduce((sum, pixels) => sum + pixels, 0);
  const rasterCapacity = () => maxRasterPixels - shapeRasterPixels();
  const clearShapeRasters = () => {
    const changed = shapeRasterReservations.size > 0;
    releaseShapeRasters?.(); shapeRasterReservations.clear(); return changed;
  };
  const plannedTextPixels = () => [...rasterPlans.values(), ...devicePlans.values()].reduce((sum, plan) => sum + plan.pixels, 0);
  function reserveShapeRaster(id, pixels) {
    if (!Number.isSafeInteger(pixels) || pixels <= 0 ||
        Math.max(rasterPixels, plannedTextPixels()) + shapeRasterPixels() - (shapeRasterReservations.get(id) ?? 0) + pixels > maxRasterPixels) return false;
    shapeRasterReservations.set(id, pixels); return true;
  }
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
  const fontSelections = new Map();
  const resourceRasterFallbacks = new Map();
  let fontLoadRequests = 0, fontEpoch = 0;
  const fontIds = new WeakMap(); let fontId = 0;
  const fontSnapshot = () => JSON.stringify([...document.fonts].map(face => {
    if (!fontIds.has(face)) fontIds.set(face, ++fontId);
    return [fontIds.get(face), face.status, face.family, face.weight, face.style, face.stretch, face.unicodeRange];
  }));
  let loadedFontSnapshot;
  let omittedFontSelections = 0;
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
      const familyKey = String(descriptor.family ?? id).toLowerCase();
      const group = fontFamilies.get(familyKey) ?? { alias: `${fontPrefix}-${fontFamilies.size}`, entries: [] };
      fontFamilies.set(familyKey, group);
      const alias = group.alias;
      provider.registerFont(resource.bytes, alias);
      const capabilities = inspectFontCapabilities(resource.bytes);
      const entry = { id, face, alias, family: descriptor.family, weight: descriptor.weight ?? 400, style: descriptor.style ?? "normal", capabilities };
      faces.set(id, entry); group.entries.push(entry);
      if (typeof descriptor.family === "string") aliasFamilies.set(alias, descriptor.family);
      const domFace = new FontFace(alias, resource.bytes, {
        weight: fontFaceWeight(capabilities, descriptor),
        style: descriptor.style || "normal",
      });
      await domFace.load();
      document.fonts.add(domFace);
      domFaces.push(domFace);
    }
    // Request the actual styles before ready: an unused @font-face may still
    // be unloaded, in which case its fallback must not become a raster master.
    const loads = new Map();
    for (const node of design.nodes.filter(node => node.type === "text")) {
      // FontFace selection depends on family/style/weight, not the requested
      // glyph size. One request still covers every required Unicode character.
      configure({ ...node, fontSize: 16 });
      const characters = loads.get(measure.font) ?? new Set();
      for (const character of String(node.text)) characters.add(character);
      loads.set(measure.font, characters);
    }
    for (const [font, characters] of loads) {
      await document.fonts.load(font, [...characters].join("") || "Hg"); fontLoadRequests++;
    }
    await document.fonts.ready;
    loadedFontSnapshot = fontSnapshot();
  } catch (error) {
    for (const { face } of faces.values()) face.delete();
    for (const face of domFaces) document.fonts.delete(face);
    provider.delete();
    throw error;
  }

  function resolvedFont(node, style) {
    const selected = faces.get(node.fontRef) ?? faces.get(node.fontFamily);
    const family = style.fontFamily === (node.fontFamily ?? "Inter") && selected
      ? selected.family : parseDesignFontFamily(style.fontFamily)?.[0]?.name;
    const group = fontFamilies.get(String(family).toLowerCase());
    // Preserve existing unbound static-text fallback semantics. A byte-proven
    // variable face may resolve a new primary instance without rewriting fontRef;
    // range faces still resolve all complete exact/variable supplied resources.
    const candidates = style === node && !selected ? (group?.entries ?? []).filter(entry => fontWeightAxis(entry.capabilities)) : group?.entries ?? [];
    const entry = selectFontEntry(candidates, { family, weight: style.fontWeight, style: style.fontStyle ?? "normal", preferredId: selected?.id });
    const key = JSON.stringify([node.id, style.fontFamily, style.fontWeight, style.fontStyle ?? "normal"]);
    if (fontSelections.has(key) || fontSelections.size < 256) fontSelections.set(key, {
      nodeId: node.id, requestedFamily: style.fontFamily, requestedWeight: style.fontWeight, requestedStyle: style.fontStyle ?? "normal",
      resourceId: entry?.id ?? null, declaredWeight: entry?.weight ?? null,
      selection: entry ? fontWeightAxis(entry.capabilities) ? "variable-instance" : "exact-face" : "unavailable",
      proof: entry?.capabilities.proof ?? "none",
    }); else omittedFontSelections++;
    return entry;
  }
  function rangeFont(node, style) {
    const entry = resolvedFont(node, style);
    if (!entry) {
      const error = new Error(`TEXT_RANGES_UNSUPPORTED: ${String(node.id).slice(0,100)} · 缺少范围字体 ${style.fontFamily} ${style.fontWeight} ${style.fontStyle} 的完整字库`);
      error.code = "TEXT_RANGES_UNSUPPORTED"; throw error;
    }
    return entry;
  }

  function rangeStyle(node, style) {
    const entry = rangeFont(node, style);
    return new CK.TextStyle({
      fontFamilies: [entry.alias], fontSize: style.fontSize,
      fontStyle: { weight: CK.FontWeight[weightKey(style.fontWeight)], width: CK.FontWidth.Normal,
        slant: style.fontStyle === "italic" ? CK.FontSlant.Italic : CK.FontSlant.Upright },
      fontVariations: canvasKitTextFontVariations(node, style, entry.capabilities), letterSpacing: node.letterSpacing || 0,
      decoration: style.textDecoration === "underline" ? CK.UnderlineDecoration :
        style.textDecoration === "line-through" ? CK.LineThroughDecoration : CK.NoDecoration,
      // HTML draws each run's decoration in that run's colour (measured, also under a node-level underline).
      decorationColor: CK.parseColorString(style.fill ?? node.fill ?? "#000000"),
    });
  }

  function finitePaint(node) { return !textHasLineBoxOrigin(node) && node.textRanges === undefined; }
  function familyCss(family, alias) {
    return alias === undefined ? designFontFamilyCss(family) :
      aliasFamilies.has(alias) ? designResourceFontFamilyCss(family, aliasFamilies.get(alias), alias) :
        designNamedFontFamilyCss(alias);
  }
  function configure(node, alias, fontSize = node.fontSize) {
    const family = familyCss(node.fontFamily, alias);
    measure.font = `${node.fontStyle || "normal"} ${node.fontWeight} ${fontSize}px ${family}`;
    measure.textBaseline = textHasLineBoxOrigin(node) || finitePaint(node) ? "alphabetic" : "hanging";
    measure.textAlign = "left";
    // Canvas "auto" can disable pairs that the editable SVG text still kerns.
    if ("fontKerning" in measure) measure.fontKerning = "normal";
    if ("letterSpacing" in measure) measure.letterSpacing = `${node.letterSpacing || 0}px`;
  }
  function hangingOffset(node, alias) {
    configure(node, alias);
    measure.textBaseline = "hanging";
    const hanging = measure.measureText("Hg");
    measure.textBaseline = "alphabetic";
    const alphabetic = measure.measureText("Hg");
    measure.textBaseline = "hanging";
    return alphabetic.actualBoundingBoxAscent - hanging.actualBoundingBoxAscent;
  }
  const browserFontMetrics = new Map(), nativeFontMetrics = new Map(), finiteFontMetrics = new Map();
  function paintBaseline(node, index, offset, alias) {
    if (finitePaint(node)) return finiteBaseline(node, index, alias);
    if (textRangeTypography(node, false).length)
      return node.y + textDisplayLineMetrics(node).offsets[index] + offset;
    return textLineBoxBaselineY(node, index, offset, { originY: currentNodes.get(node.id)?.y ?? node.y, layoutScale });
  }
  // Imported finite origin (also for finite text carrying fill/link ranges on the range raster).
  // lineOffset: a measured line top (mixed typography) moves the transported origin before the paint rounding.
  function finiteBaseline(node, index, alias, lineOffset = null) {
    {
      configure(node, alias);
      const key = measure.font;
      let metrics = finiteFontMetrics.get(key);
      if (!metrics) {
        measure.textBaseline = "alphabetic"; // already so for plain finite text; ranged finite configures "hanging"
        const measured = measure.measureText("Hg");
        metrics = { ascent: measured.fontBoundingBoxAscent, descent: measured.fontBoundingBoxDescent,
          hangingToAlphabetic: hangingOffset(node, alias) };
        if (layoutScale !== 1) {
          // Line-box metrics at the layout font size (fontSize x scale), as Blink rounds them there.
          configure(node, alias, node.fontSize * layoutScale);
          measure.textBaseline = "alphabetic";
          const scaled = measure.measureText("Hg");
          metrics.layoutMetrics = { ascent: scaled.fontBoundingBoxAscent, descent: scaled.fontBoundingBoxDescent };
        }
        finiteFontMetrics.set(key, metrics);
        configure(node, alias);
      }
      const originY = currentNodes.get(node.id)?.y ?? node.y;
      if (lineOffset !== null) return textFiniteBaselineY({ ...node, y: node.y + lineOffset }, 0, metrics, { originY: originY + lineOffset, layoutScale,
        layoutMetrics: metrics.layoutMetrics ?? null });
      return textFiniteBaselineY(node, index, metrics, { originY, layoutScale,
        layoutMetrics: metrics.layoutMetrics ?? null });
    }
  }
  function rasterBaseline(node, alias) {
    if (!textHasLineBoxOrigin(node)) return 0;
    // Line-box metrics come from the layout font size (fontSize × layout
    // scale); Canvas rounds them at that size, as Blink does.
    configure(node, alias, node.fontSize * layoutScale);
    const key = measure.font;
    let metrics = browserFontMetrics.get(key);
    if (!metrics) {
      const measured = measure.measureText("Hg");
      metrics = { ascent: measured.fontBoundingBoxAscent, descent: measured.fontBoundingBoxDescent };
      // A missing font metric is an unsupported renderer capability, not a
      // reason to silently restore the old hanging placement.
      textLineBoxAlphabeticOffset(node, metrics, layoutScale);
      browserFontMetrics.set(key, metrics);
    }
    if (layoutScale !== 1) configure(node, alias);
    return textLineBoxAlphabeticOffset(node, metrics, layoutScale);
  }
  function paragraphBaseline(node, entry) {
    if (!textHasLineBoxOrigin(node) || textRangeTypography(node, false).length)
      return hangingOffset(node, entry?.alias);
    const key = JSON.stringify([entry.id, node.fontSize * layoutScale]);
    let metrics = nativeFontMetrics.get(key);
    if (!metrics) {
      const font = new CK.Font(entry.face, node.fontSize * layoutScale);
      try {
        const measured = font.getMetrics();
        metrics = { ascent: -measured.ascent, descent: measured.descent };
        textLineBoxAlphabeticOffset(node, metrics, layoutScale);
        nativeFontMetrics.set(key, metrics);
      } finally { font.delete(); }
    }
    return textLineBoxAlphabeticOffset(node, metrics, layoutScale);
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

  const rasterOriginXCorrection = (node) => {
    const x = currentNodes.get(node.id)?.x ?? node.x;
    return Math.trunc(x * 64) / 64 - x;
  };
  function rasterAlignedX(node, width) {
    const advance = Math.ceil(width * 64) / 64;
    if (!textHasLineBoxOrigin(node) || node.textAlign !== "center" || advance >= node.width)
      return alignedX(node, width);
    // Actual HTML probes resolve the font advance upward to a layout unit,
    // then truncate the positive centered offset. The world origin has its
    // own toward-zero layout conversion, including at negative coordinates.
    return node.x + rasterOriginXCorrection(node) + Math.trunc((node.width - advance) * 32) / 64;
  }

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
  function lineGeometry(node, line, y, scale, alias, origin) {
    const geometry = rasterBounds(node, line, scale, alias);
    const x = rasterAlignedX(node, geometry.bounds.width);
    if (!origin) return { ...geometry, x, offsetX: geometry.left - geometry.padding, offsetY: geometry.top - geometry.padding };
    // Draw glyph coverage at its canonical device phase. The image's destination
    // then lands on integer device pixels, avoiding a second interpolation pass.
    const offsetX = Math.floor((x + geometry.left - geometry.padding + origin.x) * scale) / scale - origin.x - x;
    const offsetY = Math.floor((y + geometry.top - geometry.padding + origin.y) * scale) / scale - origin.y - y;
    const w = Math.max(geometry.w, Math.ceil((geometry.bounds.actualBoundingBoxRight + geometry.padding - offsetX) * scale));
    const h = Math.max(geometry.h, Math.ceil((geometry.bottom + geometry.padding - offsetY) * scale));
    if (w > 8192 || h > 8192 || w * h > 4 * 1024 * 1024)
      throw new Error(`System-font device phase exceeds the bounded per-line raster budget (${node.id})`);
    return { ...geometry, x, offsetX, offsetY, w, h };
  }
  function estimatePixels(node, scale, alias, origin) {
    if (canvasKitRangeTextRasterEligible(node))
      return String(node.text).split("\n").reduce((sum, line, i) =>
        sum + (line ? (({ w, h }) => w * h)(rangeLineGeometry(node, i, rangeBaseline(node, i, alias), scale, alias, origin)) : 0), 0);
    return String(node.text)
      .split("\n")
      .reduce((sum, line, i) => {
        const { w, h } = lineGeometry(node, line, paintBaseline(node, i, rasterBaseline(node, alias), alias), scale, alias, origin);
        return sum + w * h;
      }, 0);
  }
  function dropNodeImages(id, kind) {
    for (const [key, entry] of rasterImages)
      if (entry.nodeId === id && (!kind || entry.kind === kind)) {
        entry.image.delete();
        rasterPixels -= entry.pixels;
        rasterImages.delete(key);
      }
  }
  function rasterScaleForNode(node) {
    return activeDeviceIds.has(node.id) ? devicePlans.get(node.id).scale : rasterPlans.get(node.id)?.scale ?? 2;
  }
  function rasterSamplingForNode(node) {
    return activeDeviceIds.has(node.id) ? devicePlans.get(node.id)?.origin : null;
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
      node.lineHeightUnit,
      textHasLineBoxOrigin(node),
      ...((textHasLineBoxOrigin(node) || finitePaint(node)) ? [paintBaseline(node, 0, 0, alias) - node.y] : []),
      ...(textHasLineBoxOrigin(node) && node.textAlign === "center" ? [rasterOriginXCorrection(node)] : []),
      node.letterSpacing,
      node.textAlign,
      node.textDecoration,
      ...(layoutScale !== 1 ? [layoutScale] : []),
      // Validated range semantics (fill, link, typography): any edit re-rasters.
      ...(node.textRanges !== undefined ? [node.textRanges] : []),
      node.width,
      node.height,
      node.fill,
      node.fillPaints,
      node.stroke,
      node.strokeWidth,
      alias,
    ]);
  function prepareRasterPlan(node, alias, deviceOnly = false) {
    const signature = rasterSignature(node, alias);
    let plan = rasterPlans.get(node.id);
    if (!plan || plan.signature !== signature) {
      clearShapeRasters();
      deviceRequestKey = null;
      const scale = 2;
      dropNodeImages(node.id);
      plan = {
        node,
        alias,
        deviceOnly,
        signature,
        scale,
        pixels: estimatePixels(node, scale, alias),
        used: ++rasterUse,
      };
      rasterPlans.set(node.id, plan);
    }
    return plan;
  }
  function trimDevicePlans(masterPixels, visibleIds = activeDeviceIds) {
    let devicePixels = [...devicePlans.values()].reduce((sum, plan) => sum + plan.pixels, 0);
    const cold = [...devicePlans].sort((a, b) =>
      Number(visibleIds.has(a[0])) - Number(visibleIds.has(b[0])) || a[1].used - b[1].used);
    for (const [id, plan] of cold) {
      if (masterPixels + devicePixels <= rasterCapacity()) break;
      dropNodeImages(id, "device");
      devicePlans.delete(id);
      activeDeviceIds.delete(id);
      devicePixels -= plan.pixels;
    }
  }
  function setDeviceSampling(origins = new Map(), { retainOffscreen = false, eligibleOrigins = origins, scale = 1 } = {}) {
    if (!Number.isFinite(scale) || scale <= 0) throw new Error("Invalid device-text raster scale");
    const requestKey = JSON.stringify([scale, retainOffscreen, [...origins]]);
    if (requestKey === deviceRequestKey && eligibleOrigins === deviceEligibility) return false;
    const signature = () => JSON.stringify([...activeDeviceIds].map((id) => [id, devicePlans.get(id)?.origin, devicePlans.get(id)?.scale]));
    const before = signature();
    deviceFallbacks = [];
    // A device image remains correct when it leaves the viewport. Keep it in
    // the display list so integer-pan return trips do not rebuild every tile.
    if (!retainOffscreen) activeDeviceIds = new Set();
    else for (const id of activeDeviceIds) {
      const eligible = eligibleOrigins.get(id), cached = devicePlans.get(id)?.origin;
      if ((rasterPlans.get(id)?.deviceOnly && scale <= 1) || !eligible || !cached || eligible.x !== cached.x || eligible.y !== cached.y || devicePlans.get(id).scale !== scale)
        activeDeviceIds.delete(id);
    }
    for (const [id, origin] of origins) {
      const master = rasterPlans.get(id);
      if (!master || master.deviceOnly && scale <= 1) continue;
      let plan = devicePlans.get(id);
      if (!plan || plan.scale !== scale || plan.origin.x !== origin.x || plan.origin.y !== origin.y) {
        dropNodeImages(id, "device");
        devicePlans.delete(id);
        activeDeviceIds.delete(id);
        try {
          plan = { origin, scale, pixels: estimatePixels(master.node, scale, master.alias, origin), used: ++rasterUse };
          devicePlans.set(id, plan);
        } catch {
          // This optional variant cannot make a previously valid master fail.
          deviceFallbacks.push({ nodeId: id, scale, reason: "device-line-raster-budget" });
          continue;
        }
      }
      plan.used = ++rasterUse;
      activeDeviceIds.add(id);
    }
    // Preserve text's existing admission priority. Optional shape coverage is
    // rebuilt afterwards and falls back to vectors when these plans need space.
    const shapesCleared = plannedTextPixels() > rasterCapacity() && clearShapeRasters();
    trimDevicePlans([...rasterPlans.values()].reduce((sum, plan) => sum + plan.pixels, 0), new Set(origins.keys()));
    for (const id of origins.keys()) if (rasterPlans.has(id) && !(rasterPlans.get(id).deviceOnly && scale <= 1) && !activeDeviceIds.has(id) && !deviceFallbacks.some(entry => entry.nodeId === id))
      deviceFallbacks.push({ nodeId: id, scale, reason: "device-scene-raster-budget" });
    deviceRequestKey = requestKey;
    deviceEligibility = eligibleOrigins;
    return shapesCleared || before !== signature();
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
      if (!plan || plan.deviceOnly || plan.scale >= desired) continue;
      const pixels = estimatePixels(plan.node, desired, plan.alias);
      changes.set(id, { scale: desired, pixels });
      total += pixels - plan.pixels;
    }
    if (!changes.size) return false;
    clearShapeRasters();
    deviceRequestKey = null;
    const cold = [...rasterPlans]
      .filter(([id, plan]) => !visibleNodeIds.has(id) && plan.scale > 2)
      .sort((a, b) => a[1].used - b[1].used);
    for (const [id, plan] of cold) {
      if (total <= rasterCapacity()) break;
      const pixels = estimatePixels(plan.node, 2, plan.alias);
      changes.set(id, { scale: 2, pixels });
      total += pixels - plan.pixels;
    }
    if (total > rasterCapacity())
      throw new Error("Visible system-font text exceeds the bounded high-resolution raster budget");
    for (const [id, change] of changes) {
      const plan = rasterPlans.get(id);
      dropNodeImages(id);
      Object.assign(plan, change, { used: ++rasterUse });
    }
    trimDevicePlans(total);
    return true;
  }
  function beginScene(nextDesign, { layoutScale: nextLayoutScale = 1 } = {}) {
    const layoutChanged = nextLayoutScale !== layoutScale;
    layoutScale = nextLayoutScale;
    if (layoutChanged) { contentBoundsCache.clear(); finiteFontMetrics.clear(); }
    const nextFontSnapshot = fontSnapshot(), fontsChanged = nextFontSnapshot !== loadedFontSnapshot;
    if (fontsChanged) {
      clearShapeRasters();
      loadedFontSnapshot = nextFontSnapshot; fontEpoch++;
      for (const entry of rasterImages.values()) entry.image.delete();
      rasterImages.clear(); rasterPlans.clear(); devicePlans.clear(); activeDeviceIds.clear();
      rasterPixels = 0; deviceRequestKey = null;
      availableFamilies.clear(); browserFontMetrics.clear(); nativeFontMetrics.clear(); finiteFontMetrics.clear(); contentBoundsCache.clear();
      resourceRasterFallbacks.clear();
    }
    const sceneList = nextDesign.pages?.length
      ? nextDesign.pages.flatMap((page) =>
          page.id === nextDesign.activePageId ? nextDesign.nodes : (page.nodes ?? []),
        )
      : nextDesign.nodes;
    sceneNodes = new Map(sceneList.map((node) => [node.id, node]));
    canvasMode = nextDesign.canvas?.mode;
    const nodes = sceneList.map(htmlLineBox);
    const contentChanged = layoutChanged || nodes.some(
      (node) =>
        node.type === "text" &&
        rasterSignature(node) !== rasterSignature(currentNodes.get(node.id) ?? {}),
    );
    if (contentChanged) {
      clearShapeRasters();
      deviceRequestKey = null;
      // New/edited masters always get the full existing budget before optional
      // device images. Otherwise a valid content revision could fail while an
      // obsolete device variant still occupies its old pixels.
      for (const id of devicePlans.keys()) dropNodeImages(id, "device");
      devicePlans.clear();
      activeDeviceIds.clear();
    }
    currentNodes = new Map(nodes.map((node) => [node.id, node]));
    for (const [id, plan] of rasterPlans)
      if (currentNodes.get(id)?.type !== "text") {
        dropNodeImages(id);
        rasterPlans.delete(id);
        deviceRequestKey = null;
        devicePlans.delete(id);
        activeDeviceIds.delete(id);
      } else if (plan.signature !== rasterSignature(currentNodes.get(id), plan.alias)) {
        // A content edit can make the previous high-quality line exceed the
        // budget even after it moves offscreen. Start the revision at 2x;
        // render() upgrades only text needed by the new viewport.
        dropNodeImages(id);
        rasterPlans.delete(id);
        deviceRequestKey = null;
        devicePlans.delete(id);
        activeDeviceIds.delete(id);
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
    for (const [id] of rangeNativeFallbacks)
      if (currentNodes.get(id)?.type !== "text") rangeNativeFallbacks.delete(id);
    for (const [id] of resourceRasterFallbacks)
      if (currentNodes.get(id)?.type !== "text") resourceRasterFallbacks.delete(id);
    // A layout-scale change re-snaps every box: retained node pictures are stale too.
    return fontsChanged || layoutChanged;
  }
  function contentBounds(sourceNode) {
    const node = htmlLineBox(sourceNode);
    const signature = JSON.stringify(node),
      cached = contentBoundsCache.get(node.id);
    if (cached?.signature === signature) return cached.bounds;
    if (canvasKitRangeTextRasterEligible(node)) {
      let left = node.x, top = node.y, right = node.x + node.width, bottom = node.y + node.height;
      try {
        for (const [index, line] of String(node.text).split("\n").entries()) {
          if (!line) continue;
          const g = rangeLineGeometry(node, index, rangeBaseline(node, index, rangeAlias(node)), 1, rangeAlias(node));
          left = Math.min(left, g.x + g.left); right = Math.max(right, g.x + g.right);
          top = Math.min(top, g.y + g.top); bottom = Math.max(bottom, g.y + g.bottom);
        }
      } catch (error) {
        if (!rangeUnsupported(error)) throw error; // the node is refused at draw time; its box stays a valid bound
      }
      const pad = Math.max(node.fontSize, ...textRangeTypography(node, false).map(range => range.fontSize ?? 0));
      const bounds = { x: left - pad, y: top - pad, width: right - left + pad * 2, height: bottom - top + pad * 2 };
      contentBoundsCache.set(node.id, { signature, bounds }); return bounds;
    }
    if (node.textRanges !== undefined) {
      try { canvasKitTextRangePlan(node); }
      catch (error) {
        if (!rangeUnsupported(error)) throw error;
        // An unsupported range node is reported and left unrendered; its box stays a valid picture bound.
        const bounds = { x: node.x - node.fontSize, y: node.y - node.fontSize, width: node.width + node.fontSize * 2, height: node.height + node.fontSize * 2 };
        contentBoundsCache.set(node.id, { signature, bounds }); return bounds;
      }
      const runs = canvasKitTextRangePlan(node), lineLayout = textDisplayLineMetrics(node);
      let left = node.x, top = node.y, right = node.x + node.width, bottom = node.y + node.height;
      for (const [index] of String(node.text).split("\n").entries()) {
        const fragments = runs.filter(run => run.lineIndex === index && run.kind === "source" && run.text !== "\n");
        if (!fragments.length) continue;
        const builder = CK.ParagraphBuilder.MakeFromFontProvider(new CK.ParagraphStyle({ textStyle: rangeStyle(node, fragments[0].style), maxLines: 1 }), provider);
        let paragraph;
        try {
          for (const run of fragments) { builder.pushStyle(rangeStyle(node, run.style)); builder.addText(run.text); builder.pop(); }
          paragraph = builder.build(); paragraph.layout(1048576);
          const width = paragraph.getLongestLine(), x = alignedX(node, width);
          const base = resolvedFont(node, node) ?? rangeFont(node, fragments[0].style);
          const y = paintBaseline(node, index, paragraphBaseline(node, base)) - paragraph.getAlphabeticBaseline();
          const pad = Math.max(node.fontSize, ...fragments.map(run => run.style.fontSize));
          left = Math.min(left, x - pad); right = Math.max(right, x + width + pad);
          top = Math.min(top, y - pad); bottom = Math.max(bottom, y + paragraph.getHeight() + pad);
        } finally { paragraph?.delete(); builder.delete(); }
      }
      const bounds = { x: left, y: top, width: right - left, height: bottom - top };
      contentBoundsCache.set(node.id, { signature, bounds }); return bounds;
    }
    const entry = resolvedFont(node, node);
    const baseline = rasterBaseline(node, entry?.alias);
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
        const y = paintBaseline(node, i, baseline, entry?.alias);
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
      origin = rasterSamplingForNode(node),
      scale = origin ? devicePlans.get(node.id).scale : plan.scale;
    const { bounds, top, bottom, w, h, x, offsetX, offsetY } = lineGeometry(node, line, y, scale, alias, origin);
    const cacheKey = JSON.stringify([node.id, plan.signature, line, y, scale, origin]);
    let image = rasterImages.get(cacheKey)?.image;
    if (!image) {
      if (rasterPixels + w * h > rasterCapacity())
        throw new Error("System-font text exceeds the bounded scene raster budget");
      const raster = document.createElement("canvas");
      raster.width = w;
      raster.height = h;
      const ctx = raster.getContext("2d", { willReadFrequently: true });
      ctx.scale(scale, scale);
      ctx.translate(-offsetX, -offsetY);
      ctx.font = measure.font;
      ctx.textBaseline = textHasLineBoxOrigin(node) || finitePaint(node) ? "alphabetic" : "hanging";
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
      rasterImages.set(cacheKey, { image, nodeId: node.id, kind: origin ? "device" : "master", pixels: w * h });
      rasterPixels += w * h;
      rasterMisses++;
    } else rasterHits++;
    plan.used = ++rasterUse;
    const paint = new CK.Paint();
    canvas.drawImageRectOptions(
      image,
      CK.XYWHRect(0, 0, w, h),
      CK.XYWHRect(x + offsetX, y + offsetY, w / scale, h / scale),
      CK.FilterMode.Linear,
      CK.MipmapMode.None,
      paint,
    );
    paint.delete();
  }

  // ---- Range text on the browser same-family raster (canvasKitRangeTextRasterEligible) ----
  function rangeAlias(node) { return resolvedFont(node, node)?.alias; }
  /** Supplied face for a run, or the browser family; never a silent substitute (as the browser route). */
  function rangeRunFace(node, style) {
    const refuse = detail => { const error = new Error(`TEXT_RANGES_UNSUPPORTED: ${String(node.id).slice(0, 100)} · ${detail}`); error.code = "TEXT_RANGES_UNSUPPORTED"; throw error; };
    const selected = faces.get(node.fontRef) ?? faces.get(node.fontFamily);
    const same = style.fontFamily === (node.fontFamily ?? "Inter");
    const family = same && selected ? selected.family : parseDesignFontFamily(style.fontFamily)?.[0]?.name;
    const entry = resolvedFont(node, style);
    if (!entry && fontFamilies.get(String(family).toLowerCase())?.entries.length)
      refuse(`已提供的字体不覆盖 ${family} ${style.fontWeight} ${style.fontStyle ?? "normal"}；未合成或替代字重`);
    if (!entry && !browserFamilyAvailable({ ...node, fontFamily: style.fontFamily }))
      refuse(`浏览器没有可用的 ${style.fontFamily}；文字不会被静默替换`);
    return entry;
  }
  function rangeStyleFont(node, style, alias, size = style.fontSize) {
    const same = style.fontFamily === (node.fontFamily ?? "Inter"), entry = rangeRunFace(node, style);
    // Same CSS family list as HTML: the node's (resource-aliased) family, or the run's own family with its
    // supplied face if one exists. Glyphs absent from a supplied face fall back through the same browser stack.
    const family = same ? familyCss(node.fontFamily, alias) : entry ? designResourceFontFamilyCss(style.fontFamily, entry.family, entry.alias)
      : designFontFamilyCss(style.fontFamily);
    return `${style.fontStyle || "normal"} ${style.fontWeight} ${size}px ${family}`;
  }
  function rangeLineLayout(node, index, alias) {
    const runs = projectTextRanges(node).filter(run => run.kind === "source" && run.lineIndex === index && run.text !== "\n");
    if (runs.map(run => run.text).join("") !== String(node.text).split("\n")[index]) {
      const error = new Error("TEXT_RANGES_UNSUPPORTED: 范围显示映射不属于当前完整文字行"); error.code = "TEXT_RANGES_UNSUPPORTED"; throw error;
    }
    configure(node, alias);
    measure.textBaseline = "alphabetic"; // range rasters draw on the alphabetic baseline (finite included)
    const groups = [];
    for (const run of runs) {
      const font = rangeStyleFont(node, run.style, alias), last = groups.at(-1);
      // HTML export gives every run span its own text-decoration-line (the node's is "none"): each run is its own
      // decorating box, so offset, thickness and the skip-ink band follow the run's own font size.
      const part = { text: run.text, fill: run.style.fill, underline: run.style.textDecoration === "underline",
        lineThrough: run.style.textDecoration === "line-through", fontSize: run.style.fontSize, style: run.style };
      if (last && last.font === font) { last.text += run.text; last.parts.push(part); }
      else groups.push({ font, style: run.style, text: run.text, parts: [part] });
    }
    let x = 0;
    for (const group of groups) {
      measure.font = group.font;
      group.metrics = measure.measureText(group.text);
      group.x = x;
      let prefix = "";
      for (const part of group.parts) {
        part.x0 = x + measure.measureText(prefix).width; prefix += part.text; part.x1 = x + measure.measureText(prefix).width;
      }
      x += group.metrics.width;
    }
    for (const group of groups) for (const part of group.parts) if (part.lineThrough) part.lineThroughBox = rangeLineThrough(node, part, alias);
    configure(node, alias);
    return { groups, width: x };
  }
  /** Measured line box: the baseline sits below the line top by the largest inline box's half-leading ascent, at fontSize x layout scale. */
  function rangeBaseline(node, index, alias) {
    if (!textHasLineBoxOrigin(node)) {
      if (!textRangeTypography(node, false).length) return finiteBaseline(node, index, alias);
      // Provenanced finite typography (still finite here): the transported first line plus the measured line offsets,
      // as the SVG typography geometry (receipt line offsets from the transported origin).
      const offsets = textDisplayLineMetrics(node).offsets;
      return finiteBaseline(node, 0, alias, offsets[index] - offsets[0]);
    }
    const originY = currentNodes.get(node.id)?.y ?? node.y, strut = rasterBaseline(node, alias);
    if (!textRangeTypography(node, false).length) return textLineBoxBaselineY(node, index, strut, { originY, layoutScale });
    // Each line's baseline sits below its top by the largest run half-leading ascent (floor((lh_g + A_g - D_g) / 2)).
    const lineAlpha = line => {
      let alpha = strut;
      for (const group of rangeLineLayout(node, line, alias).groups) {
        measure.font = rangeStyleFont(node, group.style, alias, group.style.fontSize * layoutScale);
        const measured = measure.measureText("Hg");
        alpha = Math.max(alpha, textLineBoxAlphabeticOffset({ ...node, fontSize: group.style.fontSize },
          { ascent: measured.fontBoundingBoxAscent, descent: measured.fontBoundingBoxDescent }, layoutScale));
      }
      return alpha;
    };
    // A browser receipt's lineOffsets are measured baseline deltas from line 0 (measuredRangeLineGeometry), not line
    // tops: every line hangs off line 0's line-box baseline. Without a receipt the offsets are estimated line tops.
    const receipt = currentTextMetrics(node);
    const baseline = Array.isArray(receipt?.lineOffsets)
      ? textLineBoxBaselineAt(node, 0, lineAlpha(0), { originY, layoutScale, baselineDelta: receipt.lineOffsets[index] - receipt.lineOffsets[0] })
      : textLineBoxBaselineAt(node, textDisplayLineMetrics(node).offsets[index], lineAlpha(index),
        { originY, layoutScale, precedingLineHeights: textDisplayLineMetrics(node).heights.slice(0, index) });
    configure(node, alias);
    return baseline;
  }
  /**
   * Auto underline as measured in HTML (Chromium 148 forced/emulated DSF2, sizes 13/14/18/24, all exact):
   * th = fontSize x layout scale / 10; top = paint baseline + max(1, ceil(th/2)); thickness = max(1, floor(th)),
   * in layout pixels; x = the run's advance interval; colour = the run's fill.
   */
  function rangeUnderline(part) {
    const th = part.fontSize * layoutScale / 10;
    return { offset: Math.max(1, Math.ceil(th / 2)) / layoutScale, thickness: Math.max(1, Math.floor(th)) / layoutScale };
  }
  /**
   * Line-through as measured in HTML (Chromium 148 forced/emulated DSF2; Inter and Arial 13/14/16/18/20/24; 24/24 exact):
   * with A = the font ascent at fontSize x layout scale (Canvas fontBoundingBoxAscent) and th = fontSize x layout scale / 10,
   * top = paint baseline - A + round(2A/3 - th/2), thickness = max(1, floor(th)), in layout pixels; x and colour as underline.
   */
  function rangeLineThrough(node, part, alias) {
    measure.font = rangeStyleFont(node, part.style, alias, part.fontSize * layoutScale);
    const ascent = measure.measureText("Hg").fontBoundingBoxAscent, th = part.fontSize * layoutScale / 10;
    if (!Number.isFinite(ascent)) throw Error("Line-through requires a measured font ascent");
    return { offset: (Math.round(2 * ascent / 3 - th / 2) - ascent) / layoutScale, thickness: Math.max(1, Math.floor(th)) / layoutScale };
  }
  let skipInkCanvas = null;
  // HTML never skips ink around CJK characters (measured: Han, Hiragana, Hangul, fullwidth Latin and CJK
  // punctuation never open a gap, also in a CJK font; Latin descenders do, also in PingFang SC). Enclosed CJK and
  // compatibility (U+3200-33FF: ㈱㉑㊙㋐㍿㎎) and CJK compatibility forms (U+FE30-FE4F: ︳︴﹍﹏) reach the band without a gap.
  const SKIP_INK_EXEMPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\u3000-\u303f\u31f0-\u31ff\u3200-\u33ff\ufe30-\ufe4f\uff00-\uffef]/u;
  /**
   * Skip-ink (HTML auto) on the raster, from the part's own glyph alpha. Fitted on clean Chromium 148 probes
   * (Inter + Arial, 13/14/18/24, three texts, forced and emulated DSF2: 392/496 gap edges exact, worst 1 px):
   * ink = columns where the part's glyphs (alone, same font and origin) have alpha > 0.02 inside the intercept band
   * [underline top, + th) with th = fontSize / 10 unfloored (last row weighted by its share), with fractional edges;
   * each ink run is dilated by th on both sides and rounded to raster pixels. Returns raster-pixel intervals.
   */
  function rangeSkipInkGaps(part, font, underline, scale, offsetX, offsetY, width, letterSpacing) {
    const th = part.fontSize / 10, band = th * scale, rows = Math.max(1, Math.ceil(band - 1e-9));
    const rowTop = Math.round((underline.offset - offsetY) * scale);
    skipInkCanvas ??= document.createElement("canvas");
    if (skipInkCanvas.width !== width || skipInkCanvas.height !== rows) { skipInkCanvas.width = width; skipInkCanvas.height = rows; }
    const ctx = skipInkCanvas.getContext("2d", { willReadFrequently: true });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, rows);
    ctx.setTransform(scale, 0, 0, scale, -offsetX * scale, -offsetY * scale - rowTop);
    ctx.textBaseline = "alphabetic";
    if ("fontKerning" in ctx) ctx.fontKerning = "normal";
    if ("letterSpacing" in ctx) ctx.letterSpacing = letterSpacing;
    ctx.font = font;
    ctx.fillStyle = "#000";
    // Only non-CJK segments contribute ink, each at its prefix-measured position within the part.
    const chars = [...part.text];
    for (let i = 0, offset = 0; i < chars.length;) {
      if (SKIP_INK_EXEMPT.test(chars[i])) { offset += chars[i].length; i++; continue; }
      let j = i, segment = "";
      while (j < chars.length && !SKIP_INK_EXEMPT.test(chars[j])) segment += chars[j++];
      ctx.fillText(segment, part.x0 + (offset ? ctx.measureText(part.text.slice(0, offset)).width : 0), 0);
      offset += segment.length; i = j;
    }
    const data = ctx.getImageData(0, 0, width, rows).data, gaps = [], D = th * scale;
    let run = null;
    for (let x = 0; x <= width; x++) {
      let alpha = 0;
      if (x < width) for (let row = 0; row < rows; row++) alpha = Math.max(alpha, data[(row * width + x) * 4 + 3] / 255 * Math.min(1, band - row));
      if (alpha > 0.02) { if (run) { run.right = x + alpha; } else run = { left: x + 1 - alpha, right: x + alpha }; }
      else if (run) {
        const gap = [Math.round(run.left - D), Math.round(run.right + D)], last = gaps.at(-1);
        if (last && gap[0] <= last[1]) last[1] = Math.max(last[1], gap[1]); else gaps.push(gap);
        run = null;
      }
    }
    return gaps;
  }
  function rangeLineGeometry(node, index, y, scale, alias, origin) {
    const layout = rangeLineLayout(node, index, alias);
    let left = Math.min(0, -(layout.groups[0]?.metrics.actualBoundingBoxLeft ?? 0)), right = layout.width, top = 0, bottom = 0;
    for (const group of layout.groups) {
      right = Math.max(right, group.x + group.metrics.actualBoundingBoxRight);
      top = Math.min(top, -group.metrics.actualBoundingBoxAscent);
      bottom = Math.max(bottom, group.metrics.actualBoundingBoxDescent);
      for (const part of group.parts) if (part.underline) { const u = rangeUnderline(part); bottom = Math.max(bottom, u.offset + u.thickness); }
      for (const part of group.parts) if (part.lineThroughBox) top = Math.min(top, part.lineThroughBox.offset);
    }
    const padding = 3, x = rasterAlignedX(node, layout.width);
    let offsetX = left - padding, offsetY = top - padding;
    if (origin) {
      offsetX = Math.floor((x + left - padding + origin.x) * scale) / scale - origin.x - x;
      offsetY = Math.floor((y + top - padding + origin.y) * scale) / scale - origin.y - y;
    }
    const w = Math.max(1, Math.ceil((right + padding - offsetX) * scale)), h = Math.max(1, Math.ceil((bottom + padding - offsetY) * scale));
    if (w > 8192 || h > 8192 || w * h > 4 * 1024 * 1024)
      throw new Error(`System-font text exceeds the bounded per-line raster budget at ${scale}x (${node.id})`);
    return { layout, left, right, top, bottom, padding, x, y, offsetX, offsetY, w, h };
  }
  function rasterRangeLine(canvas, node, index, y, alias) {
    const plan = prepareRasterPlan(node, alias),
      origin = rasterSamplingForNode(node),
      scale = origin ? devicePlans.get(node.id).scale : plan.scale;
    const { layout, top, bottom, padding, w, h, x, offsetX, offsetY } = rangeLineGeometry(node, index, y, scale, alias, origin);
    const cacheKey = JSON.stringify([node.id, plan.signature, index, y, scale, origin]);
    let image = rasterImages.get(cacheKey)?.image;
    if (!image) {
      if (rasterPixels + w * h > rasterCapacity())
        throw new Error("System-font text exceeds the bounded scene raster budget");
      const raster = document.createElement("canvas");
      raster.width = w;
      raster.height = h;
      const ctx = raster.getContext("2d", { willReadFrequently: true });
      ctx.scale(scale, scale);
      ctx.translate(-offsetX, -offsetY);
      ctx.textBaseline = "alphabetic";
      if ("fontKerning" in ctx) ctx.fontKerning = "normal";
      if ("letterSpacing" in ctx) ctx.letterSpacing = `${node.letterSpacing || 0}px`;
      // Interior colour boundaries snap to raster pixels so every pixel is drawn by exactly one fill:
      // coverage (alpha) is then identical to drawing the shaped group once.
      const snap = value => offsetX + Math.round((value - offsetX) * scale) / scale;
      for (const group of layout.groups) {
        ctx.font = group.font;
        group.parts.forEach((part, partIndex) => {
          // The whole same-font group is shaped once (kerning across colour boundaries stays);
          // each fill shows only its own advance interval. Outer edges keep overhanging ink.
          const x0 = partIndex === 0 ? offsetX : snap(part.x0), x1 = partIndex === group.parts.length - 1 ? offsetX + w / scale : snap(part.x1);
          ctx.save();
          ctx.beginPath();
          ctx.rect(x0, top - padding, x1 - x0, bottom - top + padding * 2);
          ctx.clip();
          ctx.fillStyle = rgba(part.fill);
          ctx.fillText(group.text, group.x, 0);
          ctx.restore();
        });
        for (const part of group.parts) {
          if (!part.underline) continue;
          const underline = rangeUnderline(part);
          ctx.fillStyle = rgba(part.fill);
          // Endpoints snap to raster pixels like the colour bounds (HTML ends the line on device pixels);
          // the segments between skip-ink gaps are whole raster pixels too.
          let from = Math.round((part.x0 - offsetX) * scale);
          const to = Math.round((part.x1 - offsetX) * scale);
          const gaps = rangeSkipInkGaps(part, group.font, underline, scale, offsetX, offsetY, w, ctx.letterSpacing ?? "0px");
          for (const [gapFrom, gapTo] of [...gaps, [Infinity, Infinity]]) {
            const end = Math.min(to, gapFrom);
            if (end > from) ctx.fillRect(offsetX + from / scale, underline.offset, (end - from) / scale, underline.thickness);
            from = Math.max(from, gapTo);
            if (from >= to) break;
          }
        }
        // Line-through paints over the glyphs (CSS painting order), snapped like the underline.
        for (const part of group.parts) {
          if (!part.lineThroughBox) continue;
          const x0 = snap(part.x0), x1 = snap(part.x1);
          ctx.fillStyle = rgba(part.fill);
          ctx.fillRect(x0, part.lineThroughBox.offset, x1 - x0, part.lineThroughBox.thickness);
        }
      }
      image = CK.MakeImage({ width: w, height: h, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB },
        ctx.getImageData(0, 0, w, h).data, w * 4);
      if (!image) throw new Error("Cannot create GPU-renderable system-text image");
      rasterImages.set(cacheKey, { image, nodeId: node.id, kind: origin ? "device" : "master", pixels: w * h });
      rasterPixels += w * h;
      rasterMisses++;
    } else rasterHits++;
    plan.used = ++rasterUse;
    const paint = new CK.Paint();
    canvas.drawImageRectOptions(image, CK.XYWHRect(0, 0, w, h), CK.XYWHRect(x + offsetX, y + offsetY, w / scale, h / scale),
      CK.FilterMode.Linear, CK.MipmapMode.None, paint);
    paint.delete();
  }
  function drawRangeRaster(canvas, node, lines) {
    const alias = rangeAlias(node);
    // Every line's layout and faces are validated (and may refuse the node) before any line is drawn.
    const baselines = lines.map((line, index) => line ? rangeBaseline(node, index, alias) : null);
    for (const [index, line] of lines.entries()) if (line) rangeLineLayout(node, index, alias);
    configure(node, alias);
    try {
      const plan = prepareRasterPlan(node, alias);
      const masterPixels = [...rasterPlans.values()].reduce((sum, item) => sum + item.pixels, 0);
      if (masterPixels > rasterCapacity() || plan.pixels > rasterCapacity()) throw Error("resource-scene-raster-budget");
      trimDevicePlans(masterPixels);
    } catch (error) {
      if (!/bounded .*raster budget|resource-scene-raster-budget/u.test(error.message)) throw error;
      resourceRasterFallbacks.set(node.id, { nodeId: node.id, reason: "range-raster-budget", detail: String(error.message).slice(0, 180) });
      return false;
    }
    counters.rasterTextNodes++;
    counters.rangeRasterNodes = (counters.rangeRasterNodes ?? 0) + 1;
    lines.forEach((line, index) => { if (line) rasterRangeLine(canvas, node, index, baselines[index], alias); });
    return true;
  }

  function drawTextRanges(canvas, node, alias, lines, runs, metrics) {
    const baseStyle = { fontFamily: node.fontFamily ?? "Inter", fontSize: node.fontSize, fontWeight: node.fontWeight,
      fontStyle: node.fontStyle ?? "normal", textDecoration: node.textDecoration ?? "none" };
    // Every line is validated before any line draws: a refusal never leaves a partly drawn node.
    const lineFragments = lines.map((line, index) => {
      const fragments = runs.filter((run) => run.lineIndex === index && run.text !== "\n");
      if (fragments.map((run) => run.text).join("") !== line)
        throw new Error("TEXT_RANGES_UNSUPPORTED: 范围显示映射不属于当前完整文字行");
      for (const run of fragments) rangeFont(node, run.style);
      return fragments;
    });
    // Paint baselines from the measured line box (mixed sizes included), as HTML and the range raster place them.
    const baselines = lines.map((_, index) => rangeBaseline(node, index, alias));
    configure(node, alias);
    for (let index = 0; index < lines.length; index++) {
      const fragments = lineFragments[index];
      let builder, paragraph;
      const paints = [];
      try {
        builder = CK.ParagraphBuilder.MakeFromFontProvider(
          new CK.ParagraphStyle({ textStyle: rangeStyle(node, baseStyle), maxLines: 1 }), provider,
        );
        const background = new CK.Paint();
        background.setAlphaf(0);
        paints.push(background);
        for (const run of fragments.length ? fragments : [{ text: " ", style: { ...baseStyle, fill: node.fill } }]) {
          const foreground = makePaint(node, { type: "SOLID", color: run.style.fill, opacity: 1 });
          paints.push(foreground);
          builder.pushPaintStyle(rangeStyle(node, run.style), foreground, background);
          builder.addText(run.text);
          builder.pop();
        }
        // Every typography/paint run shares one builder and one shaped line.
        paragraph = builder.build();
        paragraph.layout(1048576);
        const width = paragraph.getLongestLine();
        if (metrics)
          maxWidthDelta = Math.max(maxWidthDelta, Math.abs(width - metrics.lineWidths[index]));
        canvas.drawParagraph(paragraph, alignedX(node, width),
          baselines[index] - paragraph.getAlphabeticBaseline());
      } finally {
        paragraph?.delete();
        builder?.delete();
        for (const paint of paints) paint.delete();
      }
    }
  }

  function draw(canvas, sourceNode, nextCounters = counters, nextUnsupported = unsupportedNode) {
    const node = htmlLineBox(sourceNode);
    counters = nextCounters;
    unsupportedNode = nextUnsupported;
    missingByNode.delete(node.id);
    unrenderedByNode.delete(node.id);
    resourceRasterFallbacks.delete(node.id);
    rangeNativeFallbacks.delete(node.id);
    try {
      if (node.textRanges !== undefined) {
        const reason = canvasKitRangeTextRasterFallbackReason(node);
        if (reason === null && drawRangeRaster(canvas, node, String(node.text).split("\n"))) return;
        if (!rangeNativeFallbacks.has(node.id)) rangeNativeFallbacks.set(node.id, { nodeId: node.id, reason: reason ?? "range-raster-budget" });
      }
      drawText(canvas, node);
    } catch (error) {
      // Only the explicit range refusal is per node; every other failure still fails the scene.
      if (!rangeUnsupported(error)) throw error;
      unsupportedNode(node, "text-ranges-unsupported", String(error.message).slice(0, 300));
      unrenderedByNode.set(node.id, String(node.text).split("\n").length);
    }
  }
  function drawText(canvas, node) {
    const entry = resolvedFont(node, node);
    const rangePayload = node.textRanges === undefined ? undefined : validateTextRanges(node);
    const lines = String(node.text).split("\n"),
      metrics = currentTextMetrics(node);
    counters.textLines += lines.length;
    if (!entry) {
      if (rangePayload) canvasKitTextRangePlan(node, { suppliedFont: false });
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
        rasterLine(canvas, node, line, paintBaseline(node, i, rasterBaseline(node))),
      );
      return;
    }
    const rangeRuns = rangePayload ? canvasKitTextRangePlan(node) : null;
    let missing = 0;
    const probes = rangeRuns ? rangeRuns.filter(run => run.kind === "source").map(run => ({
      text: run.text.replaceAll("\n", ""), entry: rangeFont(node, run.style), size: run.style.fontSize,
    })) : [{ text: node.text.replaceAll("\n", ""), entry, size: node.fontSize }];
    for (const run of probes) {
      const probe = new CK.Font(run.entry.face, run.size);
      try { missing += [...probe.getGlyphIDs(run.text, [...run.text].length)].filter(glyph => glyph === 0).length; }
      finally { probe.delete(); }
    }
    if (rangeRuns && missing) canvasKitTextRangePlan(node, { missingGlyphs: missing });
    if (missing) {
      missingByNode.set(node.id, missing);
      counters.rasterTextNodes++;
      unsupportedNode(
        node,
        "native-missing-glyph",
        `${missing} glyphs absent from supplied font; browser same-family raster cache`,
      );
      lines.forEach((line, i) =>
        rasterLine(canvas, node, line, paintBaseline(node, i, rasterBaseline(node, entry.alias), entry.alias), entry.alias),
      );
      return;
    }
    // Imported resource text keeps its historical native pixels at <=1x.
    // Above 1x a bounded same-family device image avoids a native/browser
    // font-metric and coverage phase mismatch without resampling a master.
    let finiteDevice = finitePaint(node) && canvasKitResourceTextRasterEligible({ ...node, layoutBaselineOffset: undefined });
    if (finiteDevice) {
      try { prepareRasterPlan(node, entry.alias, true); }
      catch (error) {
        if (!/bounded .*raster budget/u.test(error.message)) throw error;
        finiteDevice = false;
        resourceRasterFallbacks.set(node.id, { nodeId: node.id, reason: "finite-device-raster-budget", detail: String(error.message).slice(0, 180) });
      }
      if (activeDeviceIds.has(node.id)) {
        counters.rasterTextNodes++;
        lines.forEach((line, i) => rasterLine(canvas, node, line, paintBaseline(node, i, 0, entry.alias), entry.alias));
        return;
      }
    }
    if (canvasKitResourceTextRasterEligible(node)) {
      let rasterReady = false;
      try {
        const plan = prepareRasterPlan(node, entry.alias);
        const masterPixels = [...rasterPlans.values()].reduce((sum, item) => sum + item.pixels, 0);
        if (masterPixels > rasterCapacity()) throw Error("resource-scene-raster-budget");
        trimDevicePlans(masterPixels);
        rasterReady = plan.pixels <= rasterCapacity();
      } catch (error) {
        if (!/bounded .*raster budget|resource-scene-raster-budget/u.test(error.message)) throw error;
        resourceRasterFallbacks.set(node.id, { nodeId: node.id, reason: "resource-raster-budget", detail: String(error.message).slice(0, 180) });
      }
      if (rasterReady) {
        resourceRasterFallbacks.delete(node.id);
        counters.rasterTextNodes++;
        lines.forEach((line, i) => rasterLine(canvas, node, line, paintBaseline(node, i, rasterBaseline(node, entry.alias), entry.alias), entry.alias));
        return;
      }
    }
    if (rasterPlans.has(node.id) && !finiteDevice) {
      dropNodeImages(node.id);
      rasterPlans.delete(node.id);
      deviceRequestKey = null;
      devicePlans.delete(node.id);
      activeDeviceIds.delete(node.id);
    }
    counters.nativeTextNodes++;
    const baseline = paragraphBaseline(node, entry);
    if (rangeRuns) {
      drawTextRanges(canvas, node, entry.alias, lines, rangeRuns, metrics);
      return;
    }
    lines.forEach((line, i) => {
      const style = new CK.TextStyle({
        fontFamilies: [entry.alias],
        fontSize: node.fontSize,
        fontStyle: {
          weight: CK.FontWeight[weightKey(node.fontWeight)],
          width: CK.FontWidth.Normal,
          slant: node.fontStyle === "italic" ? CK.FontSlant.Italic : CK.FontSlant.Upright,
        },
        fontVariations: canvasKitTextFontVariations(node, node, entry.capabilities),
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
        y = (finitePaint(node) ? node.y + i * textLineHeightPixels(node) + baseline
          : paintBaseline(node, i, baseline, entry.alias)) - shape.getAlphabeticBaseline();
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
  /** Read-only diagnostic: the paint baselines a ranged node's lines are drawn on (raster and native share them). */
  function rangePaintBaselines(sourceNode) {
    const node = htmlLineBox(sourceNode), alias = rangeAlias(node);
    try { return String(node.text).split("\n").map((_, index) => rangeBaseline(node, index, alias)); }
    finally { configure(node, alias); }
  }
  return {
    draw,
    beginScene,
    rangePaintBaselines,
    fontsChanged: () => fontSnapshot() !== loadedFontSnapshot,
    setRasterScale,
    setDeviceSampling,
    hasDeviceSampling: () => activeDeviceIds.size > 0,
    rasterScaleForNode,
    rasterSamplingForNode,
    contentBounds,
    reserveShapeRaster,
    releaseShapeRaster: id => shapeRasterReservations.delete(id),
    setShapeRasterRelease: callback => { releaseShapeRasters = callback; },
    stats: () => ({
      loadedFontResources: faces.size,
      fontCapabilities: [...faces.values()].map(entry => ({ resourceId: entry.id, family: entry.family, declaredWeight: entry.weight, style: entry.style, ...entry.capabilities })),
      fontSelections: [...fontSelections.values()],
      omittedFontSelections,
      fontLoadRequests,
      fontEpoch,
      resourceTextRasterFallbacks: [...resourceRasterFallbacks.values()].slice(0, 256),
      rangeTextNativeFallbacks: [...rangeNativeFallbacks.values()].slice(0, 256),
      rangeTextNativeFallbackCount: rangeNativeFallbacks.size,
      resourceTextRasterFallbackCount: resourceRasterFallbacks.size,
      nativeMissingGlyphs: [...missingByNode.values()].reduce((sum, value) => sum + value, 0),
      unrenderedTextLines: [...unrenderedByNode.values()].reduce((sum, value) => sum + value, 0),
      maxNativeTextWidthDelta: maxWidthDelta,
      rasterTextScale: Math.max(2, ...[...rasterPlans.values()].map((plan) => plan.scale)),
      rasterTextImages: rasterImages.size,
      rasterTextCacheBytes: rasterPixels * 4,
      rasterTextCacheBudgetBytes: maxRasterPixels * 4,
      sharedRasterCacheBytes: (rasterPixels + shapeRasterPixels()) * 4,
      sharedRasterReservedBytes: (Math.max(rasterPixels, plannedTextPixels()) + shapeRasterPixels()) * 4,
      sharedRasterCacheBudgetBytes: maxRasterPixels * 4,
      rasterTextCacheHits: rasterHits,
      rasterTextCacheMisses: rasterMisses,
      rasterNodeScales: [...rasterPlans].map(([nodeId, plan]) => ({ nodeId, scale: plan.scale })),
      deviceTextNodes: activeDeviceIds.size,
      deviceTextCacheVariants: devicePlans.size,
      deviceRasterNodeScales: [...activeDeviceIds].map(nodeId => ({ nodeId, scale: devicePlans.get(nodeId).scale })),
      deviceTextFallbacks: deviceFallbacks,
    }),
    dispose() {
      clearShapeRasters(); releaseShapeRasters = null;
      for (const entry of rasterImages.values()) entry.image.delete();
      rasterImages.clear();
      rasterPlans.clear();
      devicePlans.clear();
      activeDeviceIds.clear();
      contentBoundsCache.clear();
      browserFontMetrics.clear();
      nativeFontMetrics.clear();
      rasterPixels = 0;
      for (const { face } of faces.values()) face.delete();
      aliasFamilies.clear();
      for (const face of domFaces) document.fonts.delete(face);
      provider.delete();
    },
  };
}
