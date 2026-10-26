import { settleLoadedFont, recordFontPixelMismatch } from "./fixtures/loaded-font.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { test } from "node:test";
import {
  importFigmaJson,
  prepareFigmaImport,
  createFigmaTransfer,
} from "../../../apps/design-studio/app/figma-bridge.mjs";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../../../apps/design-studio/app/document.mjs";
import { applyAllAutoLayouts, applyAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import {
  createFigmaBinding,
  createFigmaPatch,
} from "../../../apps/design-studio/app/figma-binding.mjs";
import { gridFillHugContentHeight, nativeGridPlan } from "../../../apps/design-studio/app/grid.mjs";

const actual = JSON.parse(
  await readFile(
    new URL(
      "../../fixtures/design-studio-grid-text-intrinsic-height/native-source.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const clone = (value) => structuredClone(value);
const children = (document, node) => document.nodes.filter((child) => child.parentId === node.id);
const rowByName = (document, name = "affine-HUG-cellFILL-container-last") =>
  document.nodes.find((node) => node.name === name);
const nestedRow = (document, name) => {
  const value = JSON.parse(serializeDesignDocument(document));
  const find = (nodes) => nodes.flatMap((node) => [node, ...find(node.children ?? [])]);
  return find(value.pages[0].children).find((node) => node.name === name);
};
const originals = { original: "Alpha\nBeta", expanded: "Alpha\nBeta\nGamma\nDelta" };

test("actual native Text Grid fixture preserves every real layer, source character and sizing mode", async () => {
  const imported = importFigmaJson(actual),
    document = imported.document;
  assert.deepEqual(imported.warnings, []);
  assert.equal(document.nodes.length, 57);
  assert.equal(document.nodes.filter((node) => node.layout === "grid").length, 8);
  assert.equal(document.nodes.filter((node) => node.type === "text").length, 24);
  assert(!createFigmaTransfer(document).warnings.some((warning) => warning.code === "grid-export"));
  const row = nestedRow(document, "affine-HUG-cellFILL-container-last");
  assert.doesNotThrow(() => nativeGridPlan(row));
  assert.deepEqual(
    row.children.map((cell) => [
      cell.layout,
      cell.layoutSizingHorizontal,
      cell.layoutSizingVertical,
    ]),
    Array(3).fill(["vertical", "fill", "fill"]),
  );
  for (const cell of row.children) {
    const text = cell.children[0];
    assert.equal(text.type, "text");
    assert.equal(text.text, text.textSource);
    assert.deepEqual(
      [text.layoutSizingHorizontal, text.layoutSizingVertical, text.textFlow],
      ["fill", "hug", "wrap"],
    );
  }
  assert.equal(gridFillHugContentHeight(row, row.children[0]), 40);
  const prepared = await prepareFigmaImport(actual);
  const binding = createFigmaBinding(prepared);
  const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(prepared.document)));
  assert.deepEqual(
    createFigmaPatch(binding, reopened).operations,
    [],
    "source-bound unchanged reopen remains a no-op",
  );
});

test("scoped raw copy edits settle real Text height and Grid cells without reusing stretched cell heights", () => {
  // An explicit independent width-only measurer proves dependency ordering, not
  // native font metrics. Real browser/font references are checked separately.
  const measurement = {
    configure() {},
    measure: (value) => ({
      width: value.length * 8,
      bottom: 16,
      ink: { x: 0, y: 0, width: value.length * 8, height: 16 },
    }),
    fontAvailable: () => true,
  };
  for (const name of [
    "equal-HUG-cellFILL",
    "affine-HUG-cellFILL-container-first",
    "affine-HUG-cellFILL-container-last",
  ]) {
    for (const staleHeight of [80, 170]) {
      const document = importFigmaJson(actual).document,
        row = rowByName(document, name),
        cells = children(document, row),
        text = children(document, cells[0])[0];
      row.height = staleHeight;
      cells.forEach((cell) => {
        cell.height = staleHeight;
      });
      for (const [copy, expected] of [
        [originals.original, 40],
        [originals.expanded, 80],
        [originals.original, 40],
      ]) {
        text.textSource = copy;
        applyAutoLayouts(document.nodes, [text.id], { textMeasurer: measurement });
        assert.equal(row.height, expected, `${name}/${staleHeight}/${copy}`);
        assert.deepEqual(
          cells.map((cell) => cell.height),
          [expected, expected, expected],
        );
        assert.equal(text.height, expected);
        assert.equal(text.textSource, copy);
        assert(
          cells.every(
            (cell) => cell.fill !== "transparent" && cell.layoutSizingVertical === "fill",
          ),
        );
      }
      for (const width of [630, 390, 630]) {
        row.width = width;
        applyAutoLayouts(document.nodes, [row.id], { textMeasurer: measurement });
        assert.deepEqual(
          cells.map((cell) => cell.width),
          name.startsWith("equal")
            ? [width / 3, width / 3, width / 3]
            : [0.3 * width + 20, 0.5 * width - 20, 0.2 * width],
        );
        assert.equal(row.height, 40);
      }
      const saved = serializeDesignDocument(document),
        reopened = normalizeDesignDocument(JSON.parse(saved));
      applyAllAutoLayouts(reopened.nodes, { textMeasurer: measurement });
      assert.deepEqual(JSON.parse(serializeDesignDocument(reopened)), JSON.parse(saved));
    }
  }
});

test("unproven text patterns and old Fill/Hug cycles remain outside the native Grid exception", () => {
  const baseline = nestedRow(
    importFigmaJson(actual).document,
    "affine-HUG-cellFILL-container-last",
  );
  for (const [label, edit] of [
    [
      "Fill text cycle",
      (text) => {
        text.layoutSizingVertical = "fill";
      },
    ],
    [
      "fixed text",
      (text) => {
        text.layoutSizingVertical = "fixed";
      },
    ],
    [
      "intrinsic width text",
      (text) => {
        text.layoutSizingHorizontal = "hug";
      },
    ],
    [
      "missing source",
      (text) => {
        delete text.textSource;
      },
    ],
    [
      "missing wrapping intent",
      (text) => {
        delete text.textFlow;
      },
    ],
    [
      "empty source",
      (text) => {
        text.textSource = " \n\t";
      },
    ],
    [
      "ellipsis",
      (text) => {
        text.textOverflow = "ellipsis";
      },
    ],
    [
      "hidden",
      (text) => {
        text.visible = false;
      },
    ],
    [
      "absolute",
      (text) => {
        text.layoutPositioning = "absolute";
      },
    ],
    [
      "rotation",
      (text) => {
        text.rotation = 1;
      },
    ],
    [
      "constraint",
      (text) => {
        text.minHeight = 1;
      },
    ],
    [
      "stroke",
      (text) => {
        text.strokeWidth = 1;
      },
    ],
    [
      "letter spacing",
      (text) => {
        text.letterSpacing = 1;
      },
    ],
    [
      "decoration",
      (text) => {
        text.textDecoration = "underline";
      },
    ],
    [
      "alignment",
      (text) => {
        text.textAlign = "center";
      },
    ],
  ]) {
    const row = clone(baseline);
    edit(row.children[0].children[0]);
    assert.throws(() => nativeGridPlan(row), /内在尺寸循环/u, label);
  }
  for (const mutate of [
    (cell) => {
      cell.children = [];
    },
    (cell) => {
      cell.children.push({ ...cell.children[0], id: "extra" });
    },
    (cell) => {
      delete cell.children;
      cell.type = "rectangle";
    },
  ]) {
    const row = clone(baseline);
    mutate(row.children[0]);
    assert.throws(() => nativeGridPlan(row), /内在尺寸循环/u);
  }
});

test("raw mixed/paragraph/truncated text cannot silently qualify after single-style conversion", () => {
  for (const edit of [
    (text) => {
      text.characterStyleOverrides = [1];
      text.styleOverrideTable = { 1: { fontSize: 20 } };
    },
    (text) => {
      text.lineTypes = ["UNORDERED", "NONE"];
      text.lineIndentations = [1, 0];
    },
    (text) => {
      text.lineIndentations = [1, 0];
    },
    (text) => {
      text.lineTypes = "NONE";
    },
    (text) => {
      text.lineIndentations = null;
    },
    (text) => {
      text.style.listSpacing = 12;
    },
    (text) => {
      text.style.paragraphSpacing = 12;
    },
    (text) => {
      text.style.paragraphIndent = 12;
    },
    (text) => {
      text.style.textAlignVertical = "CENTER";
    },
    (text) => {
      text.style.textAlignHorizontal = "JUSTIFIED";
    },
    (text) => {
      text.style.textCase = "UPPER";
    },
    (text) => {
      text.style.textTruncation = "ENDING";
      text.style.maxLines = 1;
    },
  ]) {
    const raw = clone(actual),
      row = raw.document.children[0].children.find(
        (node) => node.name === "affine-HUG-cellFILL-container-last",
      );
    edit(row.children[0].children[0]);
    const imported = importFigmaJson(raw),
      rejected = rowByName(imported.document);
    assert.equal(rejected.layout, "none");
    assert(imported.warnings.some((warning) => warning.code === "unsupported-grid"));
    assert.equal(
      children(imported.document, children(imported.document, rejected)[0])[0].textSource,
      originals.original,
    );
  }
});

test("real loaded-font Text wrapping, scoped edits, reopen and SVG/frontend remain strict at integer Grid widths", async (t) => {
  const { chromium } = await import("playwright"),
    { PNG } = await import("pngjs");
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 760, height: 240 },
    deviceScaleFactor: 1,
  });
  const root = resolve("apps/design-studio/app"),
    blocked = [],
    errors = [];
  const fontBytes = await readFile(resolve(root, "fonts/InterVariable.woff2"));
  const fontCss = `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${fontBytes.toString("base64")}) format('woff2');font-weight:100 900;font-style:normal;font-display:block}`;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.href === "https://grid-text.test/")
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><style>${fontCss}body{margin:0;background:#fff}</style>`,
      });
    const file = resolve(root, `.${url.pathname}`);
    if (
      url.origin === "https://grid-text.test" &&
      file.startsWith(root + sep) &&
      file.endsWith(".mjs")
    )
      return route.fulfill({ contentType: "text/javascript", body: await readFile(file) });
    blocked.push(url.href);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("https://grid-text.test/");
  const records = await page.evaluate(
    async ({ actual, fontCss }) => {
      const { importFigmaJson } = await import("/figma-bridge.mjs");
      const { serializeDesignDocument, normalizeDesignDocument, exportDesignSvg } =
        await import("/document.mjs");
      const { createBrowserTextMeasurer, measureFigmaTextDocument } =
        await import("/text-metrics.mjs");
      const { applyAutoLayouts, applyAllAutoLayouts } = await import("/layout.mjs");
      const { exportDesignFrontend } = await import("/frontend-export.mjs");
      const loaded = await document.fonts.load("400 16px Inter", "Alpha Beta");
      if (!loaded.length || loaded.some((font) => font.status !== "loaded"))
        throw Error("Exact fixture Inter face did not load");
      const stableJson = (value) =>
        JSON.stringify(value, (_key, entry) =>
          entry && typeof entry === "object" && !Array.isArray(entry)
            ? Object.fromEntries(
                Object.keys(entry)
                  .sort()
                  .map((key) => [key, entry[key]]),
              )
            : entry,
        );
      const records = [];
      for (const name of ["equal-HUG-cellFILL", "affine-HUG-cellFILL-container-first"]) {
        const raw = structuredClone(actual),
          originalRow = raw.document.children[0].children.find((node) => node.name === name);
        raw.document.children = [originalRow];
        const imported = importFigmaJson(raw),
          value = imported.document,
          row = value.nodes[0];
        const offset = row.y - 20;
        for (const node of value.nodes) node.y -= offset;
        value.canvas = { width: 760, height: 240, background: "#ffffff" };
        const cells = value.nodes.filter((node) => node.parentId === row.id),
          text = value.nodes.find((node) => node.parentId === cells[0].id);
        const sources = new Map();
        const visit = (node) => {
          sources.set(node.id, node);
          node.children?.forEach(visit);
        };
        raw.document.children.forEach(visit);
        await measureFigmaTextDocument(value, {
          nativeLineBoxes: true,
          sourceNodes: sources,
          sourceIds: new Map(imported.mapping.map((entry) => [entry.designId, entry.sourceId])),
        });
        const measurement = createBrowserTextMeasurer();
        try {
          for (const [width, copy] of [
            [630, "Alpha\nBeta"],
            [630, "Alpha\nBeta\nGamma\nDelta"],
            [630, "Alpha\nBeta"],
            [390, "Alpha\nBeta"],
            [630, "Alpha\nBeta"],
            [
              630,
              "An editable table cell wraps its original sentence when the available width changes.",
            ],
            [
              390,
              "An editable table cell wraps its original sentence when the available width changes.",
            ],
            [
              630,
              "An editable table cell wraps its original sentence when the available width changes.",
            ],
          ]) {
            row.width = width;
            text.textSource = copy;
            cells.forEach((cell) => {
              cell.height = 170;
            });
            row.height = 170;
            applyAutoLayouts(value.nodes, [row.id, text.id], { textMeasurer: measurement });
            const saved = serializeDesignDocument(value),
              reopened = normalizeDesignDocument(JSON.parse(saved));
            applyAllAutoLayouts(reopened.nodes, { textMeasurer: measurement });
            const reference = `<!doctype html><style>${fontCss}*{box-sizing:border-box}html,body{margin:0;width:760px;height:240px;background:white}.row{position:absolute;left:20px;top:20px;width:${width}px;display:grid;grid-template-columns:${name.startsWith("equal") ? "repeat(3,minmax(0,1fr))" : "minmax(0,.3fr) 32px minmax(0,.5fr) minmax(0,.2fr) 8px"};grid-template-rows:fit-content(100%);background:#e2e8f0}.cell{display:flex;flex-direction:column;min-width:0;min-height:0;align-self:stretch}.a{background:#fecaca;${name.startsWith("affine") ? "grid-column:1/span 2;padding-right:20px" : ""}}.b{background:#bbf7d0;${name.startsWith("affine") ? "grid-column:3" : ""}}.c{background:#bfdbfe;${name.startsWith("affine") ? "grid-column:4/span 2" : ""}}.copy{flex:none;width:100%;font:400 16px/20px Inter;color:#334155;white-space:pre-wrap}.c .copy{line-height:30px}</style><div class="row"><div class="cell a"><div class="copy"></div></div><div class="cell b"><div class="copy">Peer</div></div><div class="cell c"><div class="copy">Peer</div></div></div>`;
            records.push({
              name,
              width,
              copy,
              rowId: row.id,
              contentId: text.id,
              reference,
              svg: exportDesignSvg(value),
              frontend: exportDesignFrontend(JSON.parse(saved)),
              height: row.height,
              cells: cells.map((cell) => cell.height),
              text: { ...text },
              stable:
                stableJson(JSON.parse(saved)) ===
                stableJson(JSON.parse(serializeDesignDocument(reopened))),
              allFontAvailable: value.nodes
                .filter((node) => node.type === "text")
                .every((node) => node.textMetrics?.fontAvailable === true),
              loaded: loaded.map((font) => ({ family: font.family, status: font.status })),
            });
          }
        } finally {
          measurement.close();
        }
      }
      return records;
    },
    { actual, fontCss },
  );
  for (const record of records) {
    assert.equal(record.stable, true, `${record.name}/${record.width}/reopen`);
    assert.equal(record.allFontAvailable, true);
    assert.deepEqual(record.cells, [record.height, record.height, record.height]);
    assert.equal(record.text.textSource, record.copy);
    await page.setContent(record.reference);
    await page.locator(".a .copy").evaluate((node, copy) => {
      node.textContent = copy;
    }, record.copy);
    await page.evaluate(() => document.fonts.ready);
    const domHeight = await page
      .locator(".row")
      .evaluate((node) => node.getBoundingClientRect().height);
    assert.equal(record.height, domHeight, `${record.name}/${record.width} measured row height`);
    const reference = PNG.sync.read(await page.screenshot());
    for (const [mode, html] of [
      [
        "SVG",
        `<!doctype html><style>${fontCss}html,body{margin:0;background:white}svg{display:block}</style>${record.svg}`,
      ],
      ["frontend", record.frontend.replace("<head>", `<head><style>${fontCss}</style>`)],
    ]) {
      await page.setContent(html);
      await page.evaluate(() => document.fonts.ready);
      const pixels = PNG.sync.read(await page.screenshot());
      assert(
        pixels.data.equals(reference.data),
        `${record.name}/${record.width}/${mode}/${JSON.stringify(record.copy)} strict pixels`,
      );
    }
  }
  // The exported ordinary Text/Cell flow must remain editable without asking
  // canonical code to calculate a new height after each DOM source edit.
  for (const name of ["equal-HUG-cellFILL", "affine-HUG-cellFILL-container-first"]) {
    const record = records.filter((record) => record.name === name).at(-1);
    await page.setContent(record.frontend.replace("<head>", `<head><style>${fontCss}</style>`));
    const referencePage = await context.newPage();
    try {
      for (const [width, copy, expectedHeight] of [
        [390, originals.expanded, 80],
        [390, originals.original, 40],
        [390, record.copy, name.startsWith("equal") ? 120 : 140],
        [630, record.copy, 80],
      ]) {
        await page
          .locator(`[data-codeshell-source-id="${record.rowId}"]`)
          .evaluate((node, width) => {
            node.style.width = `${width}px`;
          }, width);
        await page
          .locator(`[data-codeshell-source-id="${record.contentId}"]`)
          .evaluate((node, copy) => {
            node.textContent = copy;
          }, copy);
        await page.evaluate(() => document.fonts.ready);
        const boxes = await page
          .locator(`[data-codeshell-source-id="${record.rowId}"]`)
          .evaluate((node) => ({
            height: node.getBoundingClientRect().height,
            cells: [...node.children].map((cell) => cell.getBoundingClientRect().height),
          }));
        assert.deepEqual(
          boxes,
          { height: expectedHeight, cells: [expectedHeight, expectedHeight, expectedHeight] },
          `${name}/exported source edit`,
        );
        await referencePage.setContent(
          record.reference.replace(
            `width:${record.width}px;display:grid`,
            `width:${width}px;display:grid`,
          ),
        );
        await referencePage.locator(".a .copy").evaluate((node, copy) => {
          node.textContent = copy;
        }, copy);
        await Promise.all([settleLoadedFont(page), settleLoadedFont(referencePage)]);
        const actualBytes = await page.screenshot(), expectedBytes = await referencePage.screenshot();
        await recordFontPixelMismatch(page, referencePage, actualBytes, expectedBytes, `integer-grid-${name}-${width}-${copy.length}`);
        assert(
          PNG.sync
            .read(actualBytes)
            .data.equals(PNG.sync.read(expectedBytes).data),
          `${name}/${width}/edited frontend strict pixels`,
        );
      }
    } finally {
      await referencePage.close();
    }
  }
  assert.deepEqual(blocked, []);
  assert.deepEqual(errors, []);
});
