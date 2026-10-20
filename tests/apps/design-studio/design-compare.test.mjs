import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareDesignDocuments,
  comparisonMarkdown,
} from "../../../apps/design-studio/app/design-compare.mjs";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../../../apps/design-studio/app/document.mjs";

function fixture() {
  const base = {
    x: 0,
    y: 0,
    width: 240,
    height: 80,
    fill: "#ffffff",
    stroke: "transparent",
    strokeWidth: 0,
    opacity: 1,
    rotation: 0,
    cornerRadius: 0,
    visible: true,
    locked: false,
  };
  const document = normalizeDesignDocument({
    format: "codeshell.design",
    version: 3,
    name: "Semantic comparison",
    canvas: { width: 400, height: 300, background: "#ffffff" },
    tokens: { colors: [] },
    resources: [],
    activePageId: "page",
    pages: [
      {
        id: "page",
        name: "Page",
        children: [
          {
            ...base,
            id: "frame",
            type: "frame",
            name: "Row",
            layout: "horizontal",
            gap: 12,
            padding: 16,
            alignItems: "start",
            justifyContent: "start",
            children: [
              {
                ...base,
                id: "label",
                type: "text",
                name: "Label",
                x: 16,
                y: 16,
                width: 100,
                height: 24,
                text: "Original",
                fontSize: 16,
                fontWeight: 400,
                lineHeight: 1.5,
                textAlign: "left",
                layoutSizingHorizontal: "hug",
              },
            ],
          },
        ],
      },
    ],
  });
  return JSON.parse(serializeDesignDocument(document));
}

const row = (document) => document.pages[0].children[0];
const label = (document) => row(document).children[0];
const changedProperties = (comparison, id) =>
  comparison.differences.find((entry) => entry.id === id)?.styles.map((style) => style.property) ??
  [];

test("same geometry and stable IDs cannot hide changed editable text or lost source text", () => {
  const expected = fixture(),
    actual = structuredClone(expected);
  label(actual).text = "Changed";
  const comparison = compareDesignDocuments(expected, actual);
  assert.equal(comparison.passed, false);
  assert.equal(comparison.coverage, 1);
  assert.equal(comparison.maximumGeometryDelta, 0);
  assert(changedProperties(comparison, "label").includes("text"));
  assert.match(comparisonMarkdown(comparison), /text: Original → Changed/u);

  const truncated = fixture();
  Object.assign(label(truncated), {
    text: "Original…",
    textSource: "Original full copy",
    textOverflow: "ellipsis",
  });
  const lostSource = structuredClone(truncated);
  delete label(lostSource).textSource;
  assert(
    changedProperties(compareDesignDocuments(truncated, lostSource), "label").includes(
      "textSource",
    ),
  );
});

test("Auto Layout loss and Hug/Fill becoming fixed fail even before geometry moves", () => {
  const expected = fixture(),
    actual = structuredClone(expected);
  row(actual).layout = "none";
  delete label(actual).layoutSizingHorizontal;
  label(actual).layoutPositioning = "absolute";
  const comparison = compareDesignDocuments(expected, actual);
  assert.equal(comparison.passed, false);
  assert.equal(comparison.maximumGeometryDelta, 0);
  assert(changedProperties(comparison, "frame").includes("layout"));
  assert(changedProperties(comparison, "label").includes("layoutSizingHorizontal"));
  assert(changedProperties(comparison, "label").includes("layoutPositioning"));
  assert.equal(comparison.closeRate, 0);

  const fill = fixture();
  label(fill).layoutSizingVertical = "fill";
  const fixed = structuredClone(fill);
  label(fixed).layoutSizingVertical = "fixed";
  assert(
    changedProperties(compareDesignDocuments(fill, fixed), "label").includes(
      "layoutSizingVertical",
    ),
  );
});

test("direction, wrapping, axis spacing, padding, alignment, limits and Grid semantics remain observable", () => {
  const changes = [
    ["frame", "layout", "vertical"],
    ["frame", "layoutReverse", true],
    ["frame", "layoutWrap", "wrap"],
    ["frame", "rowGap", 22],
    ["frame", "columnGap", 23],
    ["frame", "paddingLeft", 8],
    ["frame", "alignItems", "baseline"],
    ["frame", "justifyContent", "space-between"],
    ["frame", "alignContent", "stretch"],
    ["frame", "gridColumns", 3],
    ["label", "layoutAlignSelf", "end"],
    ["label", "layoutMarginBefore", "auto"],
    ["label", "minWidth", 50],
    ["label", "maxWidth", 200],
    ["label", "minHeight", 20],
    ["label", "maxHeight", 40],
    ["label", "gridColumnSpan", 2],
    ["label", "gridRowSpan", 2],
    ["label", "layoutBaselineOffset", 3],
    ["label", "textFlow", "wrap"],
    ["label", "textOverflow", "ellipsis"],
  ];
  for (const [id, property, value] of changes) {
    const expected = fixture(),
      actual = structuredClone(expected);
    (id === "frame" ? row(actual) : label(actual))[property] = value;
    const comparison = compareDesignDocuments(expected, actual);
    assert.equal(comparison.passed, false, `${id}.${property} must fail comparison`);
    assert.equal(comparison.maximumGeometryDelta, 0);
    assert(
      changedProperties(comparison, id).includes(property),
      `${id}.${property} must be reported`,
    );
    assert(
      compareDesignDocuments(actual, expected).differences.length > 0,
      `${property} removal must be reported`,
    );
  }
});

test("equivalent shorthand and omitted optional defaults do not introduce semantic differences", () => {
  const expected = fixture(),
    actual = structuredClone(expected);
  Object.assign(row(actual), {
    rowGap: 12,
    columnGap: 12,
    paddingTop: 16,
    paddingRight: 16,
    paddingBottom: 16,
    paddingLeft: 16,
    layoutReverse: false,
    layoutWrap: "none",
    alignContent: "start",
    gridColumns: 1,
    layoutSizingHorizontal: "fixed",
    layoutSizingVertical: "fixed",
  });
  Object.assign(label(actual), {
    layoutPositioning: "auto",
    layoutSizingVertical: "fixed",
    layoutAlignSelf: "auto",
    minWidth: 1,
    minHeight: 1,
    gridColumnSpan: 1,
    gridRowSpan: 1,
    textSource: label(actual).text,
    layoutBaselineOffset: 0,
  });
  assert.equal(compareDesignDocuments(expected, actual).passed, true);
  assert.equal(compareDesignDocuments(actual, expected).passed, true);
});

test("Auto Layout child order survives stable ID matching and excludes absolute overlays", () => {
  const expected = fixture();
  row(expected).children.push({ ...structuredClone(label(expected)), id: "second" });
  row(expected).children.push({
    ...structuredClone(label(expected)),
    id: "overlay",
    layoutPositioning: "absolute",
  });
  const actual = structuredClone(expected);
  row(actual).children.reverse();
  const comparison = compareDesignDocuments(expected, actual);
  assert.equal(comparison.coverage, 1);
  assert.equal(comparison.maximumGeometryDelta, 0);
  assert.equal(comparison.passed, false);
  assert(changedProperties(comparison, "frame").includes("layoutChildOrder"));
  row(actual).children = [row(expected).children[2], ...row(expected).children.slice(0, 2)];
  assert.equal(compareDesignDocuments(expected, actual).passed, true);
});

test("stable IDs still match across root ordering and geometry tolerance remains unchanged", () => {
  const expected = fixture();
  expected.pages[0].children.push({ ...structuredClone(label(expected)), id: "other" });
  const actual = structuredClone(expected);
  actual.pages[0].children.reverse();
  actual.pages[0].children[0].x += 2;
  const comparison = compareDesignDocuments(expected, actual);
  assert.equal(comparison.passed, true);
  assert.equal(comparison.coverage, 1);
  assert.equal(comparison.maximumGeometryDelta, 2);
  actual.pages[0].children[0].x += 0.01;
  assert.equal(compareDesignDocuments(expected, actual).passed, false);
});
