import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  planHtmlInlineText,
  isHtmlInlineTextDraft,
} from "../../../apps/design-studio/app/html-inline-text-plan.mjs";
const measuredCases = JSON.parse(
  await readFile(
    new URL("../../fixtures/design-studio/html-inline-measured-source.json", import.meta.url),
  ),
).cases;

function setup({
  prefix = "\n    You have 7 days left to send your application.\n    ",
  link = "View application",
  suffix = ".\n  ",
  size = 24,
  ratio = 1.25,
  weight = 700,
  offset = "3.7872px",
  linkColor = "rgb(26, 101, 166)",
} = {}) {
  const base = {
    display: "block",
    visibility: "visible",
    opacity: "1",
    position: "static",
    cssFloat: "none",
    transform: "none",
    columnCount: "auto",
    columnWidth: "auto",
    direction: "ltr",
    writingMode: "horizontal-tb",
    whiteSpace: "normal",
    textTransform: "none",
    textIndent: "0px",
    wordSpacing: "normal",
    wordBreak: "normal",
    letterSpacing: "normal",
    textAlign: "left",
    verticalAlign: "baseline",
    fontFamily: '"GDS Transport", Arial',
    fontSize: `${size}px`,
    fontWeight: String(weight),
    fontStyle: "normal",
    fontStretch: "100%",
    fontKerning: "auto",
    fontFeatureSettings: "normal",
    fontVariationSettings: "normal",
    fontVariant: "normal",
    fontVariantLigatures: "normal",
    fontVariantCaps: "normal",
    fontVariantNumeric: "normal",
    fontVariantEastAsian: "normal",
    fontVariantPosition: "normal",
    fontVariantAlternates: "normal",
    fontVariantEmoji: "normal",
    lineHeight: `${size * ratio}px`,
    color: "rgb(11, 12, 12)",
    textDecorationLine: "none",
    textShadow: "none",
    textOverflow: "clip",
    backgroundImage: "none",
    backgroundColor: "rgba(0, 0, 0, 0)",
    ...Object.fromEntries(
      ["Top", "Right", "Bottom", "Left"].flatMap((s) => [
        [`border${s}Width`, "0px"],
        [`padding${s}`, "0px"],
      ]),
    ),
  };
  const linkStyle = {
    ...base,
    display: "inline",
    color: linkColor,
    textDecorationLine: "underline",
    textDecorationColor: linkColor,
    textDecorationStyle: "solid",
    textDecorationThickness: "1px",
    textUnderlineOffset: offset,
    textDecorationSkipInk: "auto",
    textUnderlinePosition: "auto",
  };
  const p = {
      nodeType: 1,
      namespaceURI: "http://www.w3.org/1999/xhtml",
      localName: "p",
      childNodes: [],
      parentElement: null,
    },
    a = {
      nodeType: 1,
      namespaceURI: p.namespaceURI,
      localName: "a",
      childNodes: [],
      parentNode: p,
      parentElement: p,
      attrs: { href: "#" },
      getAttribute(key) {
        return this.attrs[key] ?? null;
      },
    };
  const doc = {
    contains: (node) => node === p || node === a,
    defaultView: {
      getComputedStyle: (node, pseudo) =>
        ["::before", "::after"].includes(pseudo)
          ? { content: "none" }
          : node === a
            ? linkStyle
            : base,
    },
  };
  p.ownerDocument = doc;
  a.ownerDocument = doc;
  const textNodes = [prefix, link, suffix].map((nodeValue, i) => ({
    nodeType: 3,
    nodeValue,
    ownerDocument: doc,
    parentNode: i === 1 ? a : p,
  }));
  p.childNodes = [textNodes[0], a, textNodes[2]];
  a.childNodes = [textNodes[1]];
  Object.defineProperty(p, "textContent", {
    get: () => textNodes.map((n) => n.nodeValue).join(""),
  });
  const typed = { unit: "number", value: ratio };
  p.computedStyleMap = a.computedStyleMap = () =>
    new Map([
      ["line-height", typed],
      ...["width", "height", "min-height", "max-height", "aspect-ratio"].map((key) => [
        key,
        { toString: () => (key === "max-height" ? "none" : "auto") },
      ]),
    ]);
  const legacy = prefix + link + suffix + "\u00a0",
    text = {
      id: "first-text",
      type: "text",
      text: legacy,
      textSource: legacy,
      fontFamily: "GDS Transport",
      fontSize: size,
      fontWeight: weight,
      fontStyle: "normal",
      letterSpacing: 0,
      fill: "#0b0c0c",
      strokeWidth: 0,
      opacity: 1,
      visible: true,
      rotation: 0,
    };
  const paragraph = {
    id: "real-p",
    type: "frame",
    layout: "none",
    layoutSizingHorizontal: "fill",
    children: [text],
  };
  const capturedStyle = (style) => {
    const [r, g, b] = style.color.match(/\d+/gu).map(Number);
    return {
      fontFamily: "GDS Transport",
      fontSize: size,
      fontWeight: String(weight),
      fontStyle: "normal",
      color: { r, g, b, a: 1, raw: style.color },
      textAlign: "left",
      verticalAlign: "baseline",
      textDecoration: style.textDecorationLine,
      textTransform: "none",
      lineHeight: { value: size * ratio, unit: "px" },
      letterSpacing: { value: 0, unit: "px" },
      wordBreak: "normal",
      textOverflow: "clip",
    };
  };
  let measuredOffset = 0;
  const sourceText = {
      nodeType: "text",
      content: legacy,
      styledSegments: ["p", "a", "p"].map((tag, i) => ({
        tag,
        text: [prefix, link, suffix + "\u00a0"][i],
        start: measuredOffset,
        end: (measuredOffset += [prefix, link, suffix + "\u00a0"][i].length),
        style: capturedStyle(i === 1 ? linkStyle : base),
        ...(i === 1 ? { href: "#" } : {}),
      })),
    },
    sourceParagraph = {
      nodeType: "container",
      semantic: { semanticId: "p-semantic" },
      children: [sourceText],
    },
    canonicalBySource = new WeakMap([
      [sourceParagraph, paragraph],
      [sourceText, text],
    ]);
  const value = {
    document: { pages: [{ children: [paragraph] }] },
    paragraph,
    text,
    mapping: [{ designId: paragraph.id, semanticId: "p-semantic" }, { designId: text.id }],
    capture: {
      paragraph: p,
      anchor: a,
      elements: new Map([
        ["p-semantic", p],
        ["a-semantic", a],
      ]),
      ambiguousElements: new WeakSet(),
      canonicalBySource,
      sourceParagraph,
      sourceText,
    },
  };
  return { value, base, linkStyle, p, a, doc, textNodes, typed };
}

test("staged exact banner source has one editable draft and no node/mapping deletion", () => {
  for (const [options, expected, start, end] of [
    [{}, "You have 7 days left to send your application. View application.", 47, 63],
    [
      { size: 21, ratio: 1.1904762268066407, offset: "3.3138px" },
      "You have 7 days left to send your application. View application.",
      47,
      63,
    ],
    [
      {
        prefix: "\n Contact ",
        link: "example@department.gov.uk",
        suffix: " if you think there’s a problem.\n",
        size: 19,
        ratio: 1.3157894897460938,
        weight: 400,
        offset: "2.9982px",
        linkColor: "rgb(15, 122, 82)",
      },
      "Contact example@department.gov.uk if you think there’s a problem.",
      8,
      33,
    ],
  ]) {
    const { value } = setup(options),
      before = JSON.stringify(value.document),
      mappingBefore = JSON.stringify(value.mapping);
    const result = planHtmlInlineText(value);
    assert.equal(result.supported, true, result.reason);
    const d = result.draft;
    assert.equal(d.textSource, expected);
    assert.equal(d.text, expected);
    assert.equal(d.textRanges.sourceSignature, JSON.stringify([expected]));
    assert.deepEqual([d.textRanges.ranges[0].start, d.textRanges.ranges[0].end], [start, end]);
    assert.equal(d.textRanges.ranges[0].href, "#");
    assert.equal(d.lineHeight, options.ratio ?? 1.25);
    assert.deepEqual(d.mappingEffects, {
      keptIds: ["real-p", "first-text"],
      removedIds: [],
      added: [],
    });
    assert.strictEqual(d.ownership.originalText, value.text);
    assert.strictEqual(d.ownership.originalParagraph, value.paragraph);
    assert.equal(JSON.stringify(value.document), before);
    assert.equal(JSON.stringify(value.mapping), mappingBefore);
    assert(isHtmlInlineTextDraft(d));
    assert(!isHtmlInlineTextDraft({ ...d }));
    assert(Object.isFrozen(d));
    assert(d.requiredGates.includes("native-capability"));
    assert(d.requiredGates.includes("whole-paragraph-measurement"));
  }
});

test("CSS-normal ownership preserves NBSP, supplementary UTF16 and complete raw Text owners", () => {
  const { value } = setup({ prefix: "\n A\u00a0😀 \t", link: "safe😀link", suffix: ".\n" });
  const result = planHtmlInlineText(value);
  assert(result.supported, result.reason);
  const d = result.draft;
  assert.equal(d.textSource, "A\u00a0😀 safe😀link.");
  assert.equal(
    d.textSource.slice(d.textRanges.ranges[0].start, d.textRanges.ranges[0].end),
    "safe😀link",
  );
  assert.equal(d.textRanges.ranges[0].start, 5);
  for (const unit of d.sourceMap) assert.equal(d.textSource.slice(unit.start, unit.end), unit.text);
  assert.equal(d.ownership.rawTextValues.join(""), d.ownership.rawText);
  assert(d.sourceMap.some((unit) => unit.text === "😀" && unit.end - unit.start === 2));
});

test("unbranded CSS em/rem strings never authorize authored units or positive product admission", () => {
  const { value } = setup();
  value.capture.authorDeclarations = {
    textUnderlineOffset: "0.1578em",
    textDecoration: "underline max(1px,.0625rem)",
    active: true,
    important: true,
  };
  value.capture.authorEvidence = JSON.stringify(value.capture.authorDeclarations);
  const result = planHtmlInlineText(value);
  assert(result.supported);
  assert.deepEqual(result.draft.textRanges.ranges[0].textUnderlineOffset, {
    unit: "px",
    value: 3.7872,
  });
  assert(result.draft.diagnostics.includes("CSS_UNDERLINE_OFFSET_SOURCE_UNIT_UNPROVEN"));
  assert.equal(result.draft.observations.rawAuthorEvidence, value.capture.authorEvidence);
  assert(result.draft.diagnostics.includes("CSS_UNDERLINE_THICKNESS_ROOT_DEPENDENCY_UNRESOLVED"));
});

test("literal link drafts reject normalized or empty targets even with coherent source ownership", () => {
  for (const target of [
    "#",
    "#section",
    "https://example.com/path?q=1",
    "mailto:a@example.com",
    "tel:123",
    "https:example.com",
    "https://user:password@example.com/",
    "https://example.com/has space",
    "https://example.com/\\path",
    "mailto:",
    "tel:",
    "relative.html",
    "javascript:alert(1)",
  ]) {
    const { value, a } = setup();
    a.attrs.href = target;
    value.capture.sourceText.styledSegments[1].href = target;
    const result = planHtmlInlineText(value);
    const accepted = [
      "#",
      "#section",
      "https://example.com/path?q=1",
      "mailto:a@example.com",
      "tel:123",
    ].includes(target);
    assert.equal(result.supported, accepted, target);
    if (accepted) assert.equal(result.draft.textRanges.ranges[0].href, target);
    else assert.equal(result.draft, undefined);
  }
});

test("unsupported source, metric, paint, href and ownership variants produce no draft and mutate nothing", () => {
  const variants = [
    (s) => (s.linkStyle.fontWeight = "400"),
    (s) => (s.linkStyle.fontSize = "25px"),
    (s) => (s.typed.unit = "px"),
    (s) => (s.value.paragraph.layoutSizingHorizontal = "fixed"),
    (s) =>
      (s.p.computedStyleMap = () =>
        new Map([
          ["line-height", s.typed],
          ["height", { toString: () => "60px" }],
        ])),
    (s) => (s.linkStyle.textDecorationColor = "rgb(255, 0, 0)"),
    (s) => (s.linkStyle.textDecorationStyle = "dotted"),
    (s) => (s.linkStyle.textUnderlinePosition = "under"),
    (s) => (s.linkStyle.textDecorationThickness = "auto"),
    (s) => (s.linkStyle.textUnderlineOffset = "101px"),
    (s) => (s.linkStyle.textUnderlineOffset = "0.1578em"),
    (s) => (s.linkStyle.opacity = "0"),
    (s) => (s.linkStyle.boxShadow = "0 0 1px red"),
    (s) => (s.base.whiteSpace = "pre"),
    (s) => (s.base.textIndent = "calc(5% + 2px)"),
    (s) => (s.base.direction = "rtl"),
    (s) => (s.base.transform = "translateX(1px)"),
    (s) => (s.base.columnWidth = "80px"),
    (s) => (s.linkStyle.columnCount = "2"),
    (s) => (s.value.text.text = "New user copy that must not be overwritten"),
    (s) => (s.a.attrs.href = "javascript:alert(1)"),
    (s) => (s.a.attrs.href = "relative.html"),
    (s) => (s.a.attrs.href = " #"),
    (s) => s.value.capture.ambiguousElements.add(s.a),
    (s) => s.value.capture.elements.set("p-semantic", null),
    (s) => s.value.capture.canonicalBySource.delete(s.value.capture.sourceText),
    (s) => (s.textNodes[1].nodeValue = "a different current link"),
    (s) => (s.a.attrs.href = "https://example.com/changed"),
    (s) => (s.value.paragraph = structuredClone(s.value.paragraph)),
    (s) => s.value.paragraph.children.push({ id: "run", type: "text", text: "extra" }),
    (s) => s.value.document.pages[0].children.push({ ...s.value.text }),
    (s) => s.p.childNodes.push({ nodeType: 1, localName: "br" }),
    (s) => s.a.childNodes.push({ nodeType: 1, localName: "span" }),
    (s) => (s.textNodes[1].nodeValue = " link"),
    (s) => (s.textNodes[1].nodeValue = "link "),
    (s) => (s.textNodes[0].nodeValue = "\ud800"),
    (s) => (s.textNodes[1].nodeValue = "a\u0301"),
    (s) => (s.textNodes[0].nodeValue = "x".repeat(4001)),
    (s) => (s.value.text.textRanges = {}),
  ];
  for (const mutate of variants) {
    const s = setup();
    mutate(s);
    const before = JSON.stringify(s.value.document),
      mapping = JSON.stringify(s.value.mapping);
    const result = planHtmlInlineText(s.value);
    assert.equal(result.supported, false, mutate.toString());
    assert.equal(result.draft, undefined);
    assert.equal(JSON.stringify(s.value.document), before);
    assert.equal(JSON.stringify(s.value.mapping), mapping);
  }
});

test("ancestor transform, zoom and multicolumn contexts cannot certify a same-metric paragraph", () => {
  for (const change of [
    { transform: "scale(2)" },
    { rotate: "10deg" },
    { scale: "2" },
    { translate: "1px" },
    { zoom: "2" },
    { columnCount: "2" },
    { columnWidth: "80px" },
  ]) {
    const { value, base, p, doc } = setup();
    const ancestor = { parentElement: null };
    const style = { ...base, ...change };
    p.parentElement = ancestor;
    const original = doc.defaultView.getComputedStyle;
    doc.defaultView.getComputedStyle = (node, pseudo) =>
      node === ancestor ? style : original(node, pseudo);
    const before = JSON.stringify(value.document);
    const result = planHtmlInlineText(value);
    assert.equal(result.supported, false, JSON.stringify(change));
    assert.equal(result.draft, undefined);
    assert.equal(JSON.stringify(value.document), before);
  }
  const { value, base, p, doc } = setup();
  const ancestor = { parentElement: null };
  p.parentElement = ancestor;
  const original = doc.defaultView.getComputedStyle;
  doc.defaultView.getComputedStyle = (node, pseudo) =>
    node === ancestor ? base : original(node, pseudo);
  assert.equal(planHtmlInlineText(value).supported, true);
});

test("first-line and first-letter decoration geometry variants do not become a uniform range", () => {
  for (const pseudo of ["::first-line", "::first-letter"]) {
    for (const change of [
      { textUnderlineOffset: "4px" },
      { textDecorationThickness: "2px" },
      { textDecorationSkipInk: "none" },
      { textDecorationColor: "rgb(200, 0, 0)" },
    ]) {
      const { value, p, base, doc } = setup();
      const original = doc.defaultView.getComputedStyle;
      doc.defaultView.getComputedStyle = (node, target) =>
        node === p && target === pseudo ? { ...base, ...change } : original(node, target);
      assert.equal(
        planHtmlInlineText(value).supported,
        false,
        `${pseudo}/${JSON.stringify(change)}`,
      );
    }
  }
});

test("uniform unmodeled typography does not become a paint-only range draft", () => {
  for (const change of [
    { fontStretch: "75%" },
    { fontKerning: "none" },
    { fontFeatureSettings: '"liga" 0' },
    { fontVariationSettings: '"wght" 500' },
    { fontVariant: "small-caps" },
    { fontVariantLigatures: "no-common-ligatures" },
    { fontVariantCaps: "small-caps" },
    { fontVariantNumeric: "tabular-nums" },
    { fontVariantEastAsian: "jis78" },
    { fontVariantPosition: "super" },
    { fontVariantAlternates: "historical-forms" },
    { fontVariantEmoji: "text" },
  ]) {
    const { value, base, linkStyle } = setup();
    Object.assign(base, change);
    Object.assign(linkStyle, change);
    assert.equal(planHtmlInlineText(value).supported, false, JSON.stringify(change));
  }
});

function actualMeasured(entry) {
  const s = setup({
    prefix: entry.rawDomOwners[0],
    link: entry.rawDomOwners[1],
    suffix: entry.rawDomOwners[2],
    size: entry.fontSize,
    weight: entry.fontWeight,
    ratio: entry.lineHeightTyped.value,
    offset: entry.computedOffset,
    linkColor: entry.linkColor,
  });
  s.base.lineHeight = s.linkStyle.lineHeight = entry.computedLineHeight;
  const previous = s.value.capture.sourceText,
    sourceText = structuredClone(entry.sourceText);
  s.value.capture.canonicalBySource.delete(previous);
  s.value.capture.sourceText = sourceText;
  s.value.capture.sourceParagraph.children = [sourceText];
  s.value.capture.canonicalBySource.set(sourceText, s.value.text);
  s.value.text.text = s.value.text.textSource = sourceText.content;
  s.value.text.id = entry.textId;
  s.value.paragraph.id = entry.paragraphId;
  s.value.mapping[0].designId = entry.paragraphId;
  s.value.mapping[1].designId = entry.textId;
  return s;
}

test("actual wide and four-fragment400 snapshots reconstruct three owned DOM Text intervals without scene deletions", () => {
  assert.equal(measuredCases.length, 6);
  for (const entry of measuredCases) {
    const { value } = actualMeasured(entry),
      before = JSON.stringify(value.document),
      mapping = JSON.stringify(value.mapping);
    const result = planHtmlInlineText(value);
    assert.equal(result.supported, true, `${entry.case}/${entry.width}: ${result.reason}`);
    const success = entry.case.endsWith("-success"),
      draft = result.draft;
    assert.equal(draft.textSource.length, success ? 65 : 64);
    assert.deepEqual(
      [draft.textRanges.ranges[0].start, draft.textRanges.ranges[0].end],
      success ? [8, 33] : [47, 63],
    );
    assert.equal(
      draft.measuredOwners.reduce((sum, owner) => sum + owner.measuredCount, 0),
      entry.width === 400 ? 4 : 3,
    );
    assert.equal(draft.measuredOwners.length, 3);
    assert.deepEqual(draft.mappingEffects, {
      keptIds: [entry.paragraphId, entry.textId],
      removedIds: [],
      added: [],
    });
    assert.equal(JSON.stringify(value.document), before);
    assert.equal(JSON.stringify(value.mapping), mapping);
    assert.strictEqual(draft.ownership.originalText, value.text);
  }
});

test("line-fragment gaps, order, stale content, unowned styles and unsafe source records produce no draft", () => {
  const entry = measuredCases.find((row) => row.width === 400 && !row.case.endsWith("-success"));
  for (const change of [
    (s) => s.value.capture.sourceText.styledSegments[1].start++,
    (s) => s.value.capture.sourceText.styledSegments[0].end--,
    (s) => (s.value.capture.sourceText.styledSegments[1].text = "stale fragment"),
    (s) => (s.value.capture.sourceText.styledSegments[1].tag = "span"),
    (s) => (s.value.capture.sourceText.styledSegments[2].href = "https://changed.example/"),
    (s) => (s.value.capture.sourceText.styledSegments[0].href = null),
    (s) => (s.value.capture.sourceText.styledSegments[0].href = "https://unowned.example/"),
    (s) => (s.value.capture.sourceText.styledSegments[1].style.fontWeight = "400"),
    (s) => s.value.capture.sourceText.styledSegments[1].style.fontSize++,
    (s) => (s.value.capture.sourceText.styledSegments[1].style.color.a = 0.5),
    (s) => (s.value.capture.sourceText.styledSegments[1].style.futureMetric = true),
    (s) => (s.value.capture.sourceText.styledSegments[1].style.whiteSpace = "pre"),
    (s) => (s.value.capture.sourceText.styledSegments[1].style.maxLines = null),
    (s) => (s.value.capture.sourceText.styledSegments[1].style.textShadow = null),
    (s) => (s.value.capture.sourceText.styledSegments[1].style.gradientFill = [{}]),
    (s) =>
      (s.value.capture.sourceText.styledSegments[1].style = structuredClone(
        s.value.capture.sourceText.styledSegments[2].style,
      )),
    (s) =>
      (s.value.capture.sourceText.styledSegments = Array(65).fill(
        s.value.capture.sourceText.styledSegments[0],
      )),
    (s) => {
      const segments = s.value.capture.sourceText.styledSegments;
      segments.unshift(segments.splice(2, 1)[0]);
      let offset = 0;
      for (const segment of segments) {
        segment.start = offset;
        segment.end = offset += segment.text.length;
      }
      s.value.text.text =
        s.value.text.textSource =
        s.value.capture.sourceText.content =
          segments.map((segment) => segment.text).join("");
    },
  ]) {
    const s = actualMeasured(entry);
    change(s);
    const before = JSON.stringify(s.value.document),
      mapping = JSON.stringify(s.value.mapping);
    const result = planHtmlInlineText(s.value);
    assert.equal(result.supported, false, change.toString());
    assert.equal(result.draft, undefined);
    assert.equal(JSON.stringify(s.value.document), before);
    assert.equal(JSON.stringify(s.value.mapping), mapping);
  }
});

test("live producer own undefined href on unlinked P fragments remains optional without interpreting null", () => {
  const entry = measuredCases.find((row) => row.width === 400 && !row.case.endsWith("-success"));
  const { value } = actualMeasured(entry);
  for (const segment of value.capture.sourceText.styledSegments)
    if (segment.tag === "p") segment.href = undefined;
  for (const segment of value.capture.sourceText.styledSegments)
    Object.assign(segment.style, {
      whiteSpace: undefined,
      maxLines: undefined,
      textShadow: undefined,
      gradientFill: undefined,
    });
  const result = planHtmlInlineText(value);
  assert.equal(result.supported, true, result.reason);
  assert(
    value.capture.sourceText.styledSegments
      .filter((segment) => segment.tag === "p")
      .every((segment) => Object.hasOwn(segment, "href") && segment.href === undefined),
  );
});

test("inline A typographic pseudo serialization is inert but generated A and real ancestor variants remain guarded", () => {
  const { value, a, linkStyle, doc } = setup(),
    original = doc.defaultView.getComputedStyle;
  doc.defaultView.getComputedStyle = (node, pseudo) =>
    node === a && ["::first-line", "::first-letter"].includes(pseudo)
      ? { ...linkStyle, textDecorationLine: "none", textDecorationThickness: "auto" }
      : original(node, pseudo);
  assert.equal(planHtmlInlineText(value).supported, true);
  for (const pseudo of ["::before", "::after"]) {
    const s = setup(),
      original = s.doc.defaultView.getComputedStyle;
    s.doc.defaultView.getComputedStyle = (node, target) =>
      node === s.a && target === pseudo
        ? { content: '"real painted content"' }
        : original(node, target);
    assert.equal(planHtmlInlineText(s.value).supported, false);
  }
  for (const [pseudo, change] of [
    ["::first-line", { fontSize: "40px" }],
    ["::first-letter", { color: "rgb(255, 0, 0)" }],
    [null, { opacity: "0" }],
  ]) {
    const s = setup(),
      ancestor = { parentElement: null },
      original = s.doc.defaultView.getComputedStyle;
    s.p.parentElement = ancestor;
    s.doc.defaultView.getComputedStyle = (node, target) =>
      node === ancestor
        ? { ...s.base, ...((pseudo === null ? !target : target === pseudo) ? change : {}) }
        : original(node, target);
    assert.equal(planHtmlInlineText(s.value).supported, false);
  }
  for (const display of ["table-cell", "table-caption"]) {
    const s = setup(),
      ancestor = { parentElement: null },
      original = s.doc.defaultView.getComputedStyle;
    s.p.parentElement = ancestor;
    s.doc.defaultView.getComputedStyle = (node, target) =>
      node === ancestor
        ? { ...s.base, display, ...(target === "::first-line" ? { fontSize: "40px" } : {}) }
        : original(node, target);
    assert.equal(planHtmlInlineText(s.value).supported, false, display);
  }
});
