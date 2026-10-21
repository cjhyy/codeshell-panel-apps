// Staged only: no importer calls this planner. A draft is not renderer/native
// admission, and its live ownership proof is never canonical document data.
const drafts = new WeakSet();
const HTML = "http://www.w3.org/1999/xhtml";
const ASCII_SPACE = /[\t\n\f\r ]/u;
const METRICS = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontStretch",
  "fontKerning",
  "fontFeatureSettings",
  "fontVariationSettings",
  "fontVariant",
  "fontVariantLigatures",
  "fontVariantCaps",
  "fontVariantNumeric",
  "fontVariantEastAsian",
  "fontVariantPosition",
  "fontVariantAlternates",
  "fontVariantEmoji",
  "letterSpacing",
  "wordSpacing",
  "lineHeight",
  "whiteSpace",
  "textTransform",
  "textIndent",
  "textAlign",
  "verticalAlign",
  "direction",
  "writingMode",
];
const fail = (message) => {
  throw Error(message);
};
const px = (value) => (/^-?\d+(?:\.\d+)?px$/u.test(value ?? "") ? Number.parseFloat(value) : NaN);
const bounded = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const utf8Length = (value) => {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0);
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
};
const wellFormed = (value) => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
};
function color(value) {
  if (/^#[\da-f]{6}$/iu.test(value ?? "")) return value.toLowerCase();
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(1(?:\.0+)?))?\s*\)$/u.exec(
    value ?? "",
  );
  if (!match || match.slice(1, 4).some((part) => Number(part) > 255))
    fail("Only opaque computed solid colors are supported");
  return (
    "#" +
    match
      .slice(1, 4)
      .map((part) => Number(part).toString(16).padStart(2, "0"))
      .join("")
  );
}
function href(value) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 2048 ||
    !wellFormed(value) ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    /^[\t\n\f\r ]|[\t\n\f\r ]$/u.test(value)
  )
    fail("Link target is not a bounded literal safe URL");
  if (value.startsWith("#")) return value;
  if (/^(?:mailto|tel):[^\s\\]+$/iu.test(value)) return value;
  if (!/^https?:\/\//iu.test(value) || /\s|\\/u.test(value))
    fail("Only literal absolute HTTP(S), mailto, tel or fragment links are staged");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("Relative link targets are unsupported");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
    fail("Executable or local link targets are unsupported");
  return value;
}
function indexDocument(value) {
  if (!Array.isArray(value?.pages))
    fail("Planner requires the original current hierarchical capture");
  const nodes = new Map(),
    seen = new Set();
  const visit = (node, depth) => {
    if (
      !node ||
      seen.has(node) ||
      depth > 32 ||
      nodes.size >= 10000 ||
      typeof node.id !== "string" ||
      !node.id ||
      node.id.length > 300 ||
      nodes.has(node.id)
    )
      fail("Invalid or duplicate capture ownership");
    seen.add(node);
    nodes.set(node.id, node);
    if (node.children !== undefined && !Array.isArray(node.children))
      fail("Malformed original child list");
    node.children?.forEach((child) => visit(child, depth + 1));
  };
  for (const page of value.pages) page.children?.forEach((node) => visit(node, 0));
  return nodes;
}

function normalSource(textNodes) {
  const values = textNodes.map((node) => node.nodeValue);
  if (values.some((value) => typeof value !== "string" || !wellFormed(value)))
    fail("Source must be well-formed Unicode");
  const raw = values.join("");
  if (!raw.length || raw.length > 4000)
    fail("Raw paragraph exceeds the existing 4000 UTF16 budget");
  // This first HTML subset refuses uncertain grapheme/style boundaries rather
  // than independently shaping fragments or rewriting combining sequences.
  if (/[\p{Mark}\u200d\ufe00-\ufe0f\u202a-\u202e\u2066-\u2069]/u.test(raw))
    fail(
      "Combining, variation, joiner or bidi-control source requires a separate range-boundary proof",
    );
  if (!values[1] || ASCII_SPACE.test(values[1][0]) || ASCII_SPACE.test(values[1].at(-1)))
    fail("Anchor-edge collapsed whitespace ownership is not in the initial subset");
  const units = [];
  let rawOffset = 0;
  for (const [owner, value] of values.entries()) {
    for (let offset = 0; offset < value.length; ) {
      const start = offset,
        text = String.fromCodePoint(value.codePointAt(offset));
      offset += text.length;
      if (ASCII_SPACE.test(text)) {
        const last = units.at(-1);
        if (last?.space) {
          if (last.owner !== owner) fail("Collapsed whitespace crosses a source style owner");
          last.rawEnd = rawOffset + offset;
        } else
          units.push({
            owner,
            space: true,
            text: " ",
            rawStart: rawOffset + start,
            rawEnd: rawOffset + offset,
          });
      } else
        units.push({
          owner,
          space: false,
          text,
          rawStart: rawOffset + start,
          rawEnd: rawOffset + offset,
        });
    }
    rawOffset += value.length;
  }
  if (units[0]?.space) units.shift();
  if (units.at(-1)?.space) units.pop();
  let sourceOffset = 0;
  const sourceMap = units.map(({ space: _space, ...unit }) => ({
    ...unit,
    start: sourceOffset,
    end: (sourceOffset += unit.text.length),
  }));
  const source = sourceMap.map((unit) => unit.text).join("");
  const link = sourceMap.filter((unit) => unit.owner === 1);
  if (
    !source ||
    source.length > 4000 ||
    !link.length ||
    !sourceMap.some((u) => u.owner === 0) ||
    !sourceMap.some((u) => u.owner === 2)
  )
    fail("Initial source requires nonempty Text+A+Text after CSS-normal collapse");
  return { raw, values, source, sourceMap, start: link[0].start, end: link.at(-1).end };
}
const legacyShape = (value) =>
  value
    .replace(/\u00a0/gu, " ")
    .replace(/[\t\n\f\r ]+/gu, " ")
    .replace(/^ | $/gu, "");
const plain = (value) =>
  value !== null &&
  typeof value === "object" &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value, allowed) =>
  plain(value) && Object.keys(value).every((key) => allowed.includes(key));
const familyName = (value) =>
  value
    .split(",")[0]
    .trim()
    .replace(/^["']|["']$/gu, "");
const textBoundary = (value, at) =>
  Number.isInteger(at) &&
  at >= 0 &&
  at <= value.length &&
  !(
    at > 0 &&
    at < value.length &&
    /[\ud800-\udbff]/u.test(value[at - 1]) &&
    /[\udc00-\udfff]/u.test(value[at])
  );

function measuredSourceOwners(sourceText, source, base, link, literalHref) {
  const allowedStyle = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "color",
    "textAlign",
    "verticalAlign",
    "textDecoration",
    "textTransform",
    "lineHeight",
    "letterSpacing",
    "wordBreak",
    "textOverflow",
    "whiteSpace",
    "maxLines",
    "textShadow",
    "gradientFill",
  ];
  const groups = [[], [], []];
  let group = 0,
    offset = 0;
  for (const segment of sourceText.styledSegments) {
    if (
      !exactKeys(segment, ["start", "end", "text", "style", "tag", "href"]) ||
      !textBoundary(sourceText.content, segment.start) ||
      !textBoundary(sourceText.content, segment.end) ||
      segment.start !== offset ||
      segment.end <= segment.start ||
      segment.text !== sourceText.content.slice(segment.start, segment.end)
    )
      fail("Original measured fragments must cover their exact complete UTF16 display snapshot");
    if (group === 0 && segment.tag === "a") group = 1;
    else if (group === 1 && segment.tag === "p") group = 2;
    // The maintained producer emits `href: seg.href` even for ordinary P
    // fragments. Only its optional undefined is unlinked; null is not guessed.
    if (
      segment.tag !== (group === 1 ? "a" : "p") ||
      (group === 1 ? segment.href !== literalHref : segment.href !== undefined)
    )
      fail("Measured fragment order or link ownership is not logical P+/A+/P+");
    const expected = group === 1 ? link : base,
      style = segment.style;
    const colorValue = style?.color;
    if (
      !exactKeys(style, allowedStyle) ||
      style.fontFamily !== familyName(expected.fontFamily) ||
      style.fontSize !== px(expected.fontSize) ||
      Number(style.fontWeight) !== Number(expected.fontWeight) ||
      style.fontStyle !== expected.fontStyle ||
      style.textAlign !== "left" ||
      style.verticalAlign !== expected.verticalAlign ||
      style.textDecoration !== expected.textDecorationLine ||
      style.textTransform !== expected.textTransform ||
      style.wordBreak !== "normal" ||
      expected.wordBreak !== "normal" ||
      style.textOverflow !== expected.textOverflow ||
      (style.whiteSpace !== undefined && style.whiteSpace !== expected.whiteSpace) ||
      style.maxLines !== undefined ||
      style.textShadow !== undefined ||
      style.gradientFill !== undefined ||
      !exactKeys(style.lineHeight, ["value", "unit"]) ||
      style.lineHeight.unit !== "px" ||
      style.lineHeight.value !== px(expected.lineHeight) ||
      !exactKeys(style.letterSpacing, ["value", "unit"]) ||
      style.letterSpacing.unit !== "px" ||
      style.letterSpacing.value !== 0 ||
      !exactKeys(colorValue, ["r", "g", "b", "a", "raw"]) ||
      colorValue.a !== 1 ||
      [colorValue.r, colorValue.g, colorValue.b].some(
        (channel) => !Number.isInteger(channel) || !bounded(channel, 0, 255),
      ) ||
      "#" +
        [colorValue.r, colorValue.g, colorValue.b]
          .map((channel) => channel.toString(16).padStart(2, "0"))
          .join("") !==
        color(expected.color) ||
      (colorValue.raw !== undefined && color(colorValue.raw) !== color(expected.color))
    )
      fail(
        "Every original measured fragment must retain its current logical DOM owner's supported style",
      );
    groups[group].push(segment);
    offset = segment.end;
  }
  if (
    offset !== sourceText.content.length ||
    groups.some((entries) => !entries.length) ||
    groups.some(
      (entries, index) =>
        legacyShape(entries.map((entry) => entry.text).join("")) !==
        legacyShape(source.values[index]),
    )
  )
    fail(
      "Complete original measured fragments do not reconstruct the three actual DOM Text owners",
    );
  return groups.map((entries) =>
    Object.freeze({
      measuredStart: entries[0].start,
      measuredEnd: entries.at(-1).end,
      measuredCount: entries.length,
    }),
  );
}
function typedObservation(element, property) {
  const value = element.computedStyleMap?.().get(property);
  if (!value) return null;
  const cssText = value.toString();
  if (cssText.length > 512) fail("Typed CSS observation exceeds the bounded evidence budget");
  return Object.freeze({
    cssText,
    ...(typeof value.unit === "string" ? { unit: value.unit } : {}),
    ...(typeof value.value === "number" && Number.isFinite(value.value)
      ? { value: value.value }
      : {}),
  });
}

function neutralContext(style) {
  return (
    style?.transform === "none" &&
    ["rotate", "scale", "translate", "perspective"].every((key) =>
      [undefined, "", "none"].includes(style[key]),
    ) &&
    ["", "normal", "1"].includes(style.zoom ?? "") &&
    ["auto", "1"].includes(style.columnCount) &&
    style.columnWidth === "auto"
  );
}

const ownsTypographicPseudo = (style) =>
  ["block", "flow-root", "inline-block", "list-item", "table-cell", "table-caption"].includes(
    style.display,
  );
function typographicPseudosMatch(style, view, element) {
  if (!ownsTypographicPseudo(style)) return true;
  return ["::first-line", "::first-letter"].every((pseudo) => {
    const variant = view.getComputedStyle(element, pseudo);
    return [
      ...METRICS,
      "color",
      "textDecorationLine",
      "textDecorationStyle",
      "textDecorationColor",
      "textDecorationThickness",
      "textUnderlineOffset",
      "textDecorationSkipInk",
      "textUnderlinePosition",
      "textShadow",
    ].every((key) => variant[key] === style[key]);
  });
}

function ordinary(style, view, element) {
  if (
    !style ||
    style.whiteSpace !== "normal" ||
    style.direction !== "ltr" ||
    style.writingMode !== "horizontal-tb" ||
    style.visibility !== "visible" ||
    style.opacity !== "1" ||
    style.position !== "static" ||
    style.cssFloat !== "none" ||
    !neutralContext(style) ||
    style.textTransform !== "none" ||
    style.textIndent !== "0px" ||
    !["normal", "0px"].includes(style.wordSpacing) ||
    !["normal", "0px"].includes(style.letterSpacing) ||
    !["left", "start"].includes(style.textAlign) ||
    style.verticalAlign !== "baseline" ||
    style.fontStyle !== "normal" ||
    style.fontStretch !== "100%" ||
    style.fontKerning !== "auto" ||
    style.fontFeatureSettings !== "normal" ||
    style.fontVariationSettings !== "normal" ||
    [
      "fontVariant",
      "fontVariantLigatures",
      "fontVariantCaps",
      "fontVariantNumeric",
      "fontVariantEastAsian",
      "fontVariantPosition",
      "fontVariantAlternates",
      "fontVariantEmoji",
    ].some((key) => ![undefined, "normal"].includes(style[key])) ||
    style.textShadow !== "none" ||
    style.textOverflow !== "clip" ||
    style.backgroundImage !== "none" ||
    ["boxShadow", "filter", "backdropFilter", "maskImage", "clipPath", "outlineStyle"].some(
      (key) => ![undefined, "", "none"].includes(style[key]),
    ) ||
    ![undefined, "normal"].includes(style.mixBlendMode) ||
    (style.webkitTextStrokeWidth !== undefined && px(style.webkitTextStrokeWidth) !== 0) ||
    (style.webkitTextFillColor !== undefined &&
      color(style.webkitTextFillColor) !== color(style.color)) ||
    !/^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0(?:\.0+)?\s*\)$/u.test(style.backgroundColor) ||
    ["Top", "Right", "Bottom", "Left"].some(
      (side) => px(style[`border${side}Width`]) !== 0 || px(style[`padding${side}`]) !== 0,
    ) ||
    ["::before", "::after"].some(
      (pseudo) => !["none", "normal"].includes(view.getComputedStyle(element, pseudo).content),
    ) ||
    !typographicPseudosMatch(style, view, element)
  )
    fail("Special, hidden, generated or non-normal inline typography is unsupported");
}

/** No caller in the live importer: returns an immutable proposal, never applies it. */
export function planHtmlInlineText({ document, paragraph, text, mapping, capture } = {}) {
  try {
    const nodes = indexDocument(document);
    if (
      nodes.get(paragraph?.id) !== paragraph ||
      nodes.get(text?.id) !== text ||
      paragraph.type !== "frame" ||
      text.type !== "text" ||
      paragraph.children?.length !== 1 ||
      paragraph.children[0] !== text ||
      typeof text.text !== "string" ||
      text.text.length > 4000 ||
      typeof text.textSource !== "string" ||
      text.textSource.length > 4000 ||
      !Array.isArray(mapping) ||
      mapping.length > 10000 ||
      [paragraph.id, text.id].some(
        (id) => mapping.filter((entry) => entry.designId === id).length !== 1,
      )
    )
      fail(
        "Keep the exact original P and its sole first Text; split runs or detached IDs are unsupported",
      );
    const p = capture?.paragraph,
      a = capture?.anchor,
      dom = p?.ownerDocument,
      view = dom?.defaultView;
    const pMapping = mapping.find((entry) => entry.designId === paragraph.id);
    const sourceText = capture?.sourceText,
      sourceParagraph = capture?.sourceParagraph;
    if (
      !view ||
      p?.namespaceURI !== HTML ||
      p.localName !== "p" ||
      a?.namespaceURI !== HTML ||
      a.localName !== "a" ||
      a.ownerDocument !== dom ||
      !dom.contains(p) ||
      a.parentNode !== p ||
      !capture.elements?.has(pMapping.semanticId) ||
      capture.elements.get(pMapping.semanticId) !== p ||
      ![...capture.elements.values()].includes(a) ||
      capture.ambiguousElements?.has(p) ||
      capture.ambiguousElements?.has(a) ||
      capture.canonicalBySource?.get(sourceParagraph) !== paragraph ||
      capture.canonicalBySource.get(sourceText) !== text ||
      sourceParagraph?.nodeType !== "container" ||
      sourceParagraph.semantic?.semanticId !== pMapping.semanticId ||
      sourceParagraph?.children?.length !== 1 ||
      sourceParagraph.children[0] !== sourceText ||
      sourceText.nodeType !== "text" ||
      typeof sourceText.content !== "string" ||
      sourceText.content.length > 4000 ||
      sourceText.content !== text.textSource ||
      sourceText.content !== text.text ||
      !Array.isArray(sourceText.styledSegments) ||
      !sourceText.styledSegments.length ||
      sourceText.styledSegments.length > 64
    )
      fail("Missing or ambiguous actual Element/original source ownership");
    const children = [...p.childNodes];
    if (
      children.length !== 3 ||
      children[0].nodeType !== 3 ||
      children[1] !== a ||
      children[2].nodeType !== 3 ||
      a.childNodes.length !== 1 ||
      a.childNodes[0].nodeType !== 3 ||
      children[0].parentNode !== p ||
      children[2].parentNode !== p ||
      a.childNodes[0].parentNode !== a ||
      [children[0], children[2], a.childNodes[0]].some((node) => node.ownerDocument !== dom)
    )
      fail("Only direct real Text+A(one Text)+Text is staged");
    const textNodes = [children[0], a.childNodes[0], children[2]],
      source = normalSource(textNodes);
    if (p.textContent !== source.raw)
      fail("Raw DOM ownership does not reconstruct the complete paragraph");
    const base = view.getComputedStyle(p),
      link = view.getComputedStyle(a);
    ordinary(base, view, p);
    ordinary(link, view, a);
    if (
      base.display !== "block" ||
      link.display !== "inline" ||
      METRICS.some((key) => base[key] !== link[key]) ||
      base.textDecorationLine !== "none"
    )
      fail("Metric-changing or propagated decorations are unsupported");
    const fontSize = px(base.fontSize),
      family = base.fontFamily
        .split(",")[0]
        .trim()
        .replace(/^["']|["']$/gu, "");
    const line = p.computedStyleMap?.().get("line-height"),
      linkLine = a.computedStyleMap?.().get("line-height");
    const typedBox = p.computedStyleMap?.();
    if (
      typedBox?.get("width")?.toString() !== "auto" ||
      typedBox?.get("height")?.toString() !== "auto" ||
      !["auto", "0px"].includes(typedBox?.get("min-height")?.toString()) ||
      typedBox?.get("max-height")?.toString() !== "none" ||
      typedBox?.get("aspect-ratio")?.toString() !== "auto" ||
      paragraph.layoutSizingHorizontal !== "fill" ||
      paragraph.layoutPositioning === "absolute"
    )
      fail("Initial paragraph needs proven Fill width and unconstrained auto block height");
    if (
      !bounded(fontSize, 6, 240) ||
      fontSize !== text.fontSize ||
      family !== text.fontFamily ||
      Number(base.fontWeight) !== text.fontWeight ||
      text.fontStyle !== "normal" ||
      text.letterSpacing !== 0 ||
      line?.unit !== "number" ||
      linkLine?.unit !== "number" ||
      !bounded(line.value, 0.7, 3) ||
      linkLine.value !== line.value
    )
      fail("Same-font canonical metrics and true bounded TypedOM number line height are required");
    if (
      link.textDecorationLine !== "underline" ||
      link.textDecorationStyle !== "solid" ||
      !["auto", "none"].includes(link.textDecorationSkipInk) ||
      link.textUnderlinePosition !== "auto" ||
      color(link.textDecorationColor) !== color(link.color)
    )
      fail("Only solid same-color underline geometry is staged");
    const measuredOwners = measuredSourceOwners(
      sourceText,
      source,
      base,
      link,
      a.getAttribute("href"),
    );
    for (
      let ancestor = p.parentElement, depth = 0;
      ancestor;
      ancestor = ancestor.parentElement, depth++
    ) {
      const context = view.getComputedStyle(ancestor);
      if (
        depth > 32 ||
        context.textDecorationLine !== "none" ||
        !neutralContext(context) ||
        context.visibility !== "visible" ||
        context.opacity !== "1" ||
        context.display === "none" ||
        !typographicPseudosMatch(context, view, ancestor)
      )
        fail("Ancestor decoration, transform, zoom or multicolumn context is unsupported");
    }
    const thickness = px(link.textDecorationThickness),
      offset = px(link.textUnderlineOffset);
    if (!bounded(thickness, Number.MIN_VALUE, 100) || !bounded(offset, -100, 100))
      fail("Computed px underline geometry is outside the contract");
    if (
      text.textRanges !== undefined ||
      text.lineHeightUnit !== undefined ||
      color(base.color) !== text.fill ||
      text.strokeWidth ||
      text.opacity !== 1 ||
      text.visible === false ||
      paragraph.visible === false ||
      text.rotation ||
      paragraph.rotation ||
      text.effects?.length ||
      text.shadow ||
      text.shadows ||
      text.textOverflow
    )
      fail("Original Text surface or geometry cannot be silently replaced");
    const range = {
      start: source.start,
      end: source.end,
      fill: color(link.color),
      textDecoration: "underline",
      textDecorationThickness: { unit: "px", value: thickness },
      textUnderlineOffset: { unit: "px", value: offset },
      textDecorationSkipInk: link.textDecorationSkipInk,
      href: href(a.getAttribute("href")),
    };
    const textRanges = {
      version: 1,
      sourceSignature: JSON.stringify([source.source]),
      ranges: [range],
    };
    if (utf8Length(JSON.stringify(textRanges)) > 32768 || textRanges.sourceSignature.length > 24004)
      fail("Ranged draft exceeds the source/signature budget");
    if (
      capture.authorEvidence !== undefined &&
      (typeof capture.authorEvidence !== "string" || capture.authorEvidence.length > 8000)
    )
      fail("Raw author evidence is optional bounded text, never an active-unit proof");
    const draft = Object.freeze({
      paragraphId: paragraph.id,
      textId: text.id,
      text: source.source,
      textSource: source.source,
      lineHeight: line.value,
      textRanges: Object.freeze({
        ...textRanges,
        ranges: Object.freeze([
          Object.freeze({
            ...range,
            textDecorationThickness: Object.freeze(range.textDecorationThickness),
            textUnderlineOffset: Object.freeze(range.textUnderlineOffset),
          }),
        ]),
      }),
      sourceMap: Object.freeze(source.sourceMap.map((unit) => Object.freeze(unit))),
      measuredOwners: Object.freeze(measuredOwners),
      ownership: Object.freeze({
        paragraph: p,
        anchor: a,
        textNodes: Object.freeze(textNodes),
        originalParagraph: paragraph,
        originalText: text,
        originalSourceParagraph: sourceParagraph,
        originalSourceText: sourceText,
        rawText: source.raw,
        rawTextValues: Object.freeze([...source.values]),
      }),
      observations: Object.freeze({
        computedThickness: link.textDecorationThickness,
        computedOffset: link.textUnderlineOffset,
        typedThickness: typedObservation(a, "text-decoration-thickness"),
        typedOffset: typedObservation(a, "text-underline-offset"),
        ...(capture.authorEvidence !== undefined
          ? { rawAuthorEvidence: capture.authorEvidence }
          : {}),
      }),
      mappingEffects: Object.freeze({
        keptIds: Object.freeze([paragraph.id, text.id]),
        removedIds: Object.freeze([]),
        added: Object.freeze([]),
      }),
      layoutIntent: Object.freeze({
        paragraph: Object.freeze({ layout: "vertical", layoutSizingVertical: "hug", gap: 0 }),
        text: Object.freeze({
          layoutSizingHorizontal: "fill",
          layoutSizingVertical: "hug",
          textFlow: "wrap",
        }),
      }),
      diagnostics: Object.freeze([
        "CSS_UNDERLINE_OFFSET_SOURCE_UNIT_UNPROVEN",
        "CSS_UNDERLINE_THICKNESS_SOURCE_UNIT_UNPROVEN",
        "CSS_UNDERLINE_THICKNESS_ROOT_DEPENDENCY_UNRESOLVED",
      ]),
      requiredGates: Object.freeze([
        "shared-text-ranges-validator",
        "whole-paragraph-measurement",
        "renderer-capability",
        "native-capability",
        "atomic-capture-commit",
        "inline-source-audit",
      ]),
    });
    drafts.add(draft);
    return { supported: true, draft };
  } catch (error) {
    return {
      supported: false,
      code: "HTML_INLINE_TEXT_UNSUPPORTED",
      reason: String(error.message).slice(0, 1000),
    };
  }
}

export const isHtmlInlineTextDraft = (value) => drafts.has(value);
