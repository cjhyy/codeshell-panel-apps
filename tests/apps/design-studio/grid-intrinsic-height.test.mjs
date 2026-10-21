import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  importFigmaJson,
  createFigmaTransfer,
} from "../../../apps/design-studio/app/figma-bridge.mjs";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../../../apps/design-studio/app/document.mjs";
import { applyAllAutoLayouts, applyAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { gridFillHugContentHeight, nativeGridPlan } from "../../../apps/design-studio/app/grid.mjs";

const actual = JSON.parse(
  await readFile(
    new URL(
      "../../fixtures/design-studio-grid-intrinsic-height/native-source.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const clone = (value) => JSON.parse(JSON.stringify(value));
const descendants = (nodes, node) => nodes.filter((child) => child.parentId === node.id);
const rowByName = (document, name = "affine-HUG-cellFILL-container-last") =>
  document.nodes.find((node) => node.name === name);
const nestedRow = (document, name) => {
  const value = JSON.parse(serializeDesignDocument(document));
  const find = (nodes) => nodes.flatMap((node) => [node, ...find(node.children ?? [])]);
  return find(value.pages[0].children).find((node) => node.name === name);
};

test("actual native Grid export supplement preserves all eight real rows and modes", () => {
  const imported = importFigmaJson(actual),
    document = imported.document;
  assert.deepEqual(imported.warnings, []);
  assert.equal(
    document.nodes.length,
    57,
    "native Page is not a design node; all real board/row/cell/content layers remain",
  );
  assert.equal(document.nodes.filter((node) => node.layout === "grid").length, 8);
  assert(!createFigmaTransfer(document).warnings.some((warning) => warning.code === "grid-export"));
  const row = nestedRow(document, "affine-HUG-cellFILL-container-last");
  assert.doesNotThrow(() => nativeGridPlan(row));
  assert.deepEqual(
    row.children.map((cell) => [cell.layoutSizingHorizontal, cell.layoutSizingVertical]),
    Array(3).fill(["fill", "fill"]),
  );
  assert.equal(gridFillHugContentHeight(row, row.children[0]), 40);
});

test("scoped nested edits grow and shrink opaque Fill cells independently of stale stretched heights", () => {
  for (const name of [
    "equal-HUG-cellFILL",
    "affine-HUG-cellFILL-container-last",
    "affine-HUG-cellFILL-container-first",
    "affine-HUG-cellFILL-fixed500content",
  ]) {
    for (const staleHeight of [80, 170]) {
      const document = importFigmaJson(clone(actual)).document,
        row = rowByName(document, name),
        cells = descendants(document.nodes, row),
        content = descendants(document.nodes, cells[0])[0];
      row.height = staleHeight;
      cells.forEach((cell) => {
        cell.height = staleHeight;
      });
      for (const height of [40, 80, 40]) {
        content.height = height;
        applyAutoLayouts(document.nodes, [cells[0].id]);
        assert.equal(row.height, height, `${name} ignores stale${staleHeight}`);
        assert.deepEqual(
          cells.map((cell) => cell.height),
          [height, height, height],
        );
        assert(
          cells.every(
            (cell) =>
              cell.layoutSizingVertical === "fill" &&
              cell.layoutSizingHorizontal === "fill" &&
              cell.fill !== "transparent",
          ),
        );
        assert.equal(content.height, height);
      }
      for (const width of [630, 390, 630]) {
        row.width = width;
        applyAutoLayouts(document.nodes, [row.id]);
        assert.deepEqual(
          cells.map((cell) => cell.width),
          name.startsWith("equal")
            ? [width / 3, width / 3, width / 3]
            : [0.3 * width + 20, 0.5 * width - 20, 0.2 * width],
        );
        assert.equal(row.height, 40);
        assert.deepEqual(
          cells.map((cell) => cell.height),
          [40, 40, 40],
        );
        if (name.endsWith("fixed500content"))
          assert.equal(content.width, 500, "real overflow never expands the tracks");
      }
      const source = serializeDesignDocument(document),
        reopened = normalizeDesignDocument(JSON.parse(source));
      applyAllAutoLayouts(reopened.nodes);
      assert.equal(serializeDesignDocument(reopened), source);
      assert.equal(reopened.nodes.length, 57);
    }
  }
});

test("unproven content and existing cycles cannot bypass the vertical Fill/HUG guard", () => {
  const document = importFigmaJson(actual).document,
    baseline = nestedRow(document, "affine-HUG-cellFILL-container-last");
  for (const [label, edit] of [
    [
      "basic Fill rectangle",
      (cell) => {
        delete cell.children;
        cell.type = "rectangle";
        delete cell.layout;
      },
    ],
    [
      "empty Frame",
      (cell) => {
        cell.children = [];
      },
    ],
    [
      "Fill descendant cycle",
      (cell) => {
        cell.children[0].layoutSizingVertical = "fill";
      },
    ],
    [
      "unproven Hug text",
      (cell) => {
        cell.children[0].type = "text";
        cell.children[0].layoutSizingVertical = "hug";
      },
    ],
    [
      "two flow children",
      (cell) => {
        cell.children.push({ ...cell.children[0], id: "extra" });
      },
    ],
    [
      "hidden content",
      (cell) => {
        cell.children[0].visible = false;
      },
    ],
    [
      "absolute content",
      (cell) => {
        cell.children[0].layoutPositioning = "absolute";
      },
    ],
    [
      "padding",
      (cell) => {
        cell.paddingTop = 1;
      },
    ],
    [
      "gap",
      (cell) => {
        cell.gap = 1;
      },
    ],
    [
      "stroke",
      (cell) => {
        cell.strokeWidth = 1;
      },
    ],
    [
      "size bound",
      (cell) => {
        cell.minHeight = 2;
      },
    ],
    [
      "multiple rows",
      (_cell, row) => {
        row.gridRows = 2;
        row.gridRowSizes.push({ type: "hug" });
      },
    ],
    [
      "horizontal Hug cycle",
      (_cell, row) => {
        row.gridColumnSizes[0] = { type: "hug" };
      },
    ],
  ]) {
    const row = clone(baseline);
    edit(row.children[0], row);
    assert.throws(() => nativeGridPlan(row), /内在尺寸循环|HUG/u, label);
  }
});

test("full-tree import rejects unsupported content and removes only the rejected parent relationship", () => {
  const raw = clone(actual),
    row = raw.document.children[0].children.find(
      (node) => node.name === "affine-HUG-cellFILL-container-last",
    );
  row.children[0].children = [];
  const nestedGrid = clone(
    raw.document.children[0].children.find((node) => node.name === "equal-HUG-cellHUG"),
  );
  nestedGrid.id = "nested-grid";
  nestedGrid.gridRowAnchorIndex = 0;
  nestedGrid.gridColumnAnchorIndex = 3;
  nestedGrid.gridColumnSpan = 2;
  nestedGrid.gridRowSpan = 1;
  row.children[2] = nestedGrid;
  const imported = importFigmaJson(raw),
    parent = rowByName(imported.document);
  assert.equal(parent.layout, "none");
  assert.equal(parent.gridRows, undefined);
  const children = descendants(imported.document.nodes, parent);
  for (const child of children)
    for (const key of [
      "gridColumnAnchorIndex",
      "gridRowAnchorIndex",
      "gridColumnSpan",
      "gridRowSpan",
      "gridChildHorizontalAlign",
      "gridChildVerticalAlign",
    ])
      assert.equal(child[key], undefined, key);
  const ownGrid = children.find((child) => child.name === "equal-HUG-cellHUG");
  assert.equal(ownGrid.layout, "grid");
  assert.equal(ownGrid.gridRows, 1);
  assert.equal(ownGrid.gridColumnSizes.length, 3);
  assert(imported.warnings.some((warning) => warning.code === "unsupported-grid"));
});

test("integer native-derived Grid retains strict SVG/frontend pixels and intrinsic exported CSS edits", async (t) => {
  const { chromium } = await import("playwright"),
    { PNG } = await import("pngjs");
  const { exportDesignSvg } = await import("../../../apps/design-studio/app/document.mjs");
  const { exportDesignFrontend } =
    await import("../../../apps/design-studio/app/frontend-export.mjs");
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 760, height: 1140 },
    deviceScaleFactor: 1,
  });
  const external = [];
  await context.route("**/*", (route) => {
    external.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  const raw = clone(actual);
  raw.document.children = [
    raw.document.children[0].children.find((node) => node.name === "equal-HUG-cellFILL"),
  ];
  const document = importFigmaJson(raw).document;
  document.canvas = { width: 760, height: 1140, background: "#ffffff" };
  const row = rowByName(document, "equal-HUG-cellFILL"),
    cells = descendants(document.nodes, row),
    content = descendants(document.nodes, cells[0])[0];
  const reference = (width, height) =>
    `<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;width:760px;height:1140px;background:#fff}.row{position:absolute;left:${row.x}px;top:${row.y}px;display:grid;width:${width}px;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:fit-content(100%);background:#e2e8f0}.cell{display:flex;flex-direction:column;align-self:stretch;min-width:0;min-height:0}.a{background:#fecaca}.b{background:#bbf7d0}.c{background:#bfdbfe}.content{flex:none;width:100%;background:#334155}</style><div class="row"><div class="cell a"><div class="content" style="height:${height}px"></div></div><div class="cell b"><div class="content" style="height:20px"></div></div><div class="cell c"><div class="content" style="height:30px"></div></div></div>`;
  for (const [width, height] of [
    [630, 40],
    [390, 80],
    [390, 40],
    [630, 40],
  ]) {
    row.width = width;
    content.height = height;
    applyAutoLayouts(document.nodes, [row.id]);
    await page.setContent(reference(width, height));
    const expected = PNG.sync.read(await page.screenshot());
    await page.setContent(
      `<!doctype html><style>html,body{margin:0}svg{display:block}</style>${exportDesignSvg(document)}`,
    );
    assert(
      PNG.sync.read(await page.screenshot()).data.equals(expected.data),
      `SVG strict ${width}/${height}`,
    );
    await page.setContent(exportDesignFrontend(JSON.parse(serializeDesignDocument(document))));
    assert(
      PNG.sync.read(await page.screenshot()).data.equals(expected.data),
      `frontend strict ${width}/${height}`,
    );
  }
  await page.setContent(exportDesignFrontend(JSON.parse(serializeDesignDocument(document))));
  for (const height of [80, 40]) {
    await page.locator(`[data-codeshell-source-id="${content.id}"]`).evaluate((node, height) => {
      node.style.height = `${height}px`;
    }, height);
    const boxes = await page
      .locator(`[data-codeshell-source-id="${row.id}"]`)
      .evaluate((node) => ({
        height: node.getBoundingClientRect().height,
        cellHeights: [...node.children].map((child) => child.getBoundingClientRect().height),
        html: node.outerHTML,
      }));
    assert.equal(
      boxes.height,
      height,
      `exported HUG height must remain intrinsic after real CSS content edit: ${boxes.html}`,
    );
    assert.deepEqual(boxes.cellHeights, [height, height, height]);
    const editedPixels = PNG.sync.read(await page.screenshot());
    const referencePage = await context.newPage();
    await referencePage.setContent(reference(630, height));
    const expected = PNG.sync.read(await referencePage.screenshot());
    await referencePage.close();
    assert(editedPixels.data.equals(expected.data), `edited CSS strict height${height}`);
  }
  assert.deepEqual(external, []);
});
