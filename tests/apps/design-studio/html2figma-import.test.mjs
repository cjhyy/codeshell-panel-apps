import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG as PngImage } from "pngjs";
import {
  normalizeDesignDocument,
  serializeDesignDocument,
} from "../../../apps/design-studio/app/document.mjs";
import {
  createPortableDesign,
  planPortableDesign,
} from "../../../apps/design-studio/app/portable-backup.mjs";
import { preparePluginFile } from "../../../apps/design-studio/app/figma-plugin/v3-input.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/design-studio/app");
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const hash = async (value) => createHash("sha256").update(value).digest("hex");
const allTransferNodes = (transfer) => {
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  for (const page of transfer.pages) for (const node of page.children) visit(node);
  return nodes;
};
const byHtmlId = (document, id, type) =>
  document.nodes.find((node) => {
    if (type && node.type !== type) return false;
    try {
      return JSON.parse(node.notes).attributes?.id === id;
    } catch {
      return false;
    }
  });

async function fixture(t) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage(),
    external = [],
    errors = [];
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.href === "https://import.test/")
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><div id="parent-marker">Parent stays intact</div>',
      });
    if (url.href === "https://import.test/bridge-ui.html")
      return route.fulfill({
        contentType: "text/html",
        body: await readFile(resolve(appRoot, "figma-plugin/ui.html")),
      });
    if (
      url.origin === "https://import.test" &&
      url.pathname.startsWith("/app/") &&
      url.pathname.endsWith(".mjs")
    ) {
      const path = resolve(appRoot, url.pathname.slice(5));
      if (path.startsWith(`${appRoot}/`))
        return route.fulfill({ body: await readFile(path), contentType: "text/javascript" });
    }
    external.push(url.href);
    return route.abort();
  });
  await page.goto("https://import.test/");
  const capture = async (html, options = {}) =>
    page.evaluate(
      async ({ html, options }) => {
        const { captureWorkspaceHtmlResult } = await import("/app/html-import.mjs");
        const textReads = [],
          assetReads = [];
        const readText = async (path) => {
          textReads.push(path);
          return options.textFiles?.[path];
        };
        const readAsset =
          options.assetFiles === undefined
            ? undefined
            : async (path) => {
                assetReads.push(path);
                return options.assetFiles[path];
              };
        const result = await captureWorkspaceHtmlResult({
          sourcePath: options.sourcePath ?? "pages/home.html",
          html,
          readText,
          readAsset,
          rootSelector: options.rootSelector ?? "html",
          viewportWidth: options.width ?? 480,
          viewportHeight: options.height ?? 360,
          ...(options.engine ? { engine: options.engine } : {}),
        });
        return {
          document: result.document,
          resourcePlans: result.resourcePlans,
          report: result.report,
          mapping: result.mapping,
          textReads,
          assetReads,
          remainingFrames: document.querySelectorAll("iframe").length,
          inputScriptRan: window.importPwned ?? null,
          parentMarker: document.querySelector("#parent-marker")?.textContent,
        };
      },
      { html, options },
    );
  return { page, capture, external, errors };
}

test("production HTML import keeps fixed-height flex children and CSS margins stable through reflow and resize", async (t) => {
  const f = await fixture(t);
  const html = `<style>*{box-sizing:border-box}body{margin:0}#root{display:flex;width:100%;height:240px;padding:20px;gap:16px}#fixed{width:100px;height:120px;background:blue}#fluid{flex:1;height:120px;background:orange}</style><main id="root"><div id="fixed"></div><div id="fluid"></div></main>`;
  const captured = await f.capture(html, { rootSelector: "#root", width: 640, height: 240 });
  const design = normalizeDesignDocument(captured.document);
  const fixed = byHtmlId(design, "fixed"),
    fluid = byHtmlId(design, "fluid");
  const geometry = (node) => [node.x, node.y, node.width, node.height];
  const before = design.nodes.map(geometry);
  applyAllAutoLayouts(design.nodes);
  assert.deepEqual(design.nodes.map(geometry), before);
  assert.deepEqual(geometry(fixed), [20, 20, 100, 120]);
  assert.deepEqual(geometry(fluid), [136, 20, 484, 120]);
  design.nodes.find((node) => node.id === "html-viewport").width = 400;
  byHtmlId(design, "root").width = 400;
  applyAllAutoLayouts(design.nodes);
  assert.deepEqual(geometry(fixed), [20, 20, 100, 120]);
  assert.deepEqual(geometry(fluid), [136, 20, 244, 120]);

  const margins = await f.capture(
    `<style>*{box-sizing:border-box}body{margin:0}#root{display:flex;width:100%;height:240px;padding:20px;gap:12px}.item{width:100px;height:100px;margin-right:8px}</style><main id="root"><div id="first" class="item"></div><div id="second" class="item"></div></main>`,
    { rootSelector: "#root", width: 640, height: 240 },
  );
  const marginDesign = normalizeDesignDocument(margins.document);
  assert.equal(byHtmlId(marginDesign, "root").layout, "horizontal");
  assert.equal(
    margins.report.warnings.some((warning) => warning.code === "layout-margin-fixed"),
    false,
  );
  applyAllAutoLayouts(marginDesign.nodes);
  assert.deepEqual(geometry(byHtmlId(marginDesign, "first")), [20, 20, 100, 100]);
  assert.deepEqual(geometry(byHtmlId(marginDesign, "second")), [140, 20, 100, 100]);
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("bordered flex and block frames retain content insets and content-box size bounds after resize", async (t) => {
  const f = await fixture(t);
  const html = `<style>*{box-sizing:border-box}body{margin:0}#root{display:flex;flex-direction:column;width:100%;height:240px;padding:20px;border:2px solid #111}#card{padding:12px;border:3px solid #222}#bounded{box-sizing:content-box;max-width:160px;min-height:20px;height:20px;padding:4px;border:2px solid #333}#last{height:20px;margin-top:12px}</style><main id="root"><section id="card"><div id="bounded"></div><div id="last"></div></section></main>`;
  const captured = await f.capture(html, { rootSelector: "#root", width: 640, height: 240 });
  await f.page.setContent(html);
  const observed = await f.page.evaluate(async ({ documentValue }) => {
    const { normalizeDesignDocument } = await import("/app/document.mjs");
    const { applyAllAutoLayouts } = await import("/app/layout.mjs");
    const value = normalizeDesignDocument(documentValue);
    const byId = (id) => value.nodes.find((node) =>
      JSON.parse(node.notes ?? "{}").attributes?.id === id);
    const results = [];
    for (const width of [640, 400]) {
      document.querySelector("#root").style.width = `${width}px`;
      value.nodes.find((node) => node.id === "html-viewport").width = width;
      byId("root").width = width;
      applyAllAutoLayouts(value.nodes);
      results.push(["root", "card", "bounded", "last"].map((id) => {
        const expected = document.querySelector(`#${id}`).getBoundingClientRect(), actual = byId(id);
        return { id, expected: [expected.x, expected.y, expected.width, expected.height],
          actual: [actual.x, actual.y, actual.width, actual.height] };
      }));
    }
    return { results, bounded: { minHeight: byId("bounded").minHeight, maxWidth: byId("bounded").maxWidth },
      layouts: [byId("root").layout, byId("card").layout] };
  }, { documentValue: captured.document });
  for (const result of observed.results.flat()) assert.deepEqual(result.actual, result.expected, result.id);
  assert.deepEqual(observed.bounded, { minHeight: 32, maxWidth: 172 });
  assert.deepEqual(observed.layouts, ["vertical", "vertical"]);
  assert(!captured.report.warnings.some((warning) => warning.code === "border-stroke-alignment"));
  assert(normalizeDesignDocument(captured.document).nodes.filter(node=>node.strokeSides).every(node=>node.strokeAlign==="inside"));
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("CSS percentage bounds never become pixel bounds while px and resolved em constraints retain their box sizing", async (t) => {
  const f = await fixture(t);
  const captured = await f.capture(
    `<style>*{box-sizing:border-box}body{margin:0;font:20px Arial}#root{display:flex;flex-direction:column;width:100%;height:240px;padding:20px}#fluid{max-width:100%;height:20px}#minimum{width:20px;min-width:50%;height:20px}#absolute,#borderbox{width:20px;min-width:2em;max-width:8em;height:20px;padding:4px;border:2px solid #111}#absolute{box-sizing:content-box}#pixels{width:20px;min-width:24px;max-width:96px;height:20px;padding:4px;border:2px solid #111;box-sizing:content-box}#fraction{width:50%;height:20px}</style><main id="root"><div id="fluid"></div><div id="minimum"></div><div id="absolute"></div><div id="borderbox"></div><div id="pixels"></div><div id="fraction"></div></main>`,
    { rootSelector: "#root", width: 640, height: 240 },
  );
  const value = normalizeDesignDocument(captured.document);
  const fluid = byHtmlId(value, "fluid"), minimum = byHtmlId(value, "minimum");
  assert.equal(fluid.maxWidth, undefined);
  assert.equal(minimum.minWidth, undefined);
  assert.deepEqual([byHtmlId(value, "absolute").minWidth, byHtmlId(value, "absolute").maxWidth], [52, 172]);
  assert.deepEqual([byHtmlId(value, "borderbox").minWidth, byHtmlId(value, "borderbox").maxWidth], [40, 160]);
  assert.deepEqual([byHtmlId(value, "pixels").minWidth, byHtmlId(value, "pixels").maxWidth], [36, 108]);
  for (const node of [fluid, minimum])
    assert(captured.report.warnings.some((warning) => warning.code === "css-size-bound-fixed" && warning.nodeId === node.id));
  assert(captured.report.warnings.some((warning) => warning.code === "css-percentage-size-fixed" && warning.nodeId === byHtmlId(value, "fraction").id));
  for (const width of [640, 400]) {
    value.nodes.find((node) => node.id === "html-viewport").width = width;
    byHtmlId(value, "root").width = width;
    applyAllAutoLayouts(value.nodes);
    assert.equal(fluid.width, width - 40);
    assert.equal(minimum.width, 300, "Unsupported relative minimum retains measured width");
    assert.equal(byHtmlId(value, "fraction").width, 300, "Unsupported percentage width retains measured width");
  }
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("plain HTML paragraphs retain measured wrapping and hug layout across resize, reopen and source edits", async (t) => {
  const f = await fixture(t);
  const captured = await f.capture(
    `<style>*{box-sizing:border-box}body{margin:0;font-family:Arial}#root{display:flex;width:100%;height:240px;padding:20px}#card{display:flex;flex:1;flex-direction:column;gap:12px;padding:16px}h1,p{margin:0}h1{font-size:24px;line-height:30px}p{font-size:16px;line-height:24px}#actions{display:flex;height:32px}#actions span{padding:6px 12px;font:14px/20px Arial}</style><main id="root"><section id="card"><h1>Editable Auto Layout</h1><p id="copy">Content should reflow when the frame gets narrower.</p><div id="actions"><span id="action-label">Save</span></div></section></main>`,
    { rootSelector: "#root", width: 640, height: 240 },
  );
  const result = await f.page.evaluate(async (input) => {
    const { normalizeDesignDocument, serializeDesignDocument } = await import("/app/document.mjs");
    const { applyAllAutoLayouts, applyAutoLayouts } = await import("/app/layout.mjs");
    const { currentTextMetrics } = await import("/app/text-metrics.mjs");
    const documentValue = normalizeDesignDocument(input);
    const byId = (value, id, type = "frame") =>
      value.nodes.find((node) => {
        try {
          return node.type === type && JSON.parse(node.notes ?? "{}").attributes?.id === id;
        } catch {
          return false;
        }
      });
    documentValue.nodes.find((node) => node.id === "html-viewport").width = 400;
    byId(documentValue, "root").width = 400;
    applyAllAutoLayouts(documentValue.nodes);
    const copy = byId(documentValue, "copy"),
      text = byId(documentValue, "copy", "text");
    const initial = {
      wrapper: { layout: copy.layout, height: copy.height, sizing: copy.layoutSizingVertical },
      text: structuredClone(text),
      actionsY: byId(documentValue, "actions").y,
      measured: Boolean(currentTextMetrics(text)),
    };
    const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(documentValue)));
    const reopenedBefore = serializeDesignDocument(reopened);
    applyAllAutoLayouts(reopened.nodes);
    const unchangedOnReopen = serializeDesignDocument(reopened) === reopenedBefore;
    text.textSource =
      "Edited content must reflow without resizing the frame, and its following action row must move down as the paragraph grows.";
    applyAutoLayouts(documentValue.nodes, new Set([copy.id]));
    const changed = {
      text: structuredClone(text),
      height: copy.height,
      y: copy.y,
      actionsY: byId(documentValue, "actions").y,
      gap: byId(documentValue, "card").gap,
      measured: Boolean(currentTextMetrics(text)),
    };
    text.fontWeight = 700;
    applyAutoLayouts(documentValue.nodes, new Set([copy.id]));
    const label = byId(documentValue, "action-label", "text"),
      labelBox = byId(documentValue, "action-label");
    const labelWidth = labelBox.width;
    label.textSource = "Save changes";
    applyAutoLayouts(documentValue.nodes, new Set([labelBox.id]));
    const hugLabel = {
      text: label.text,
      width: labelBox.width,
      previousWidth: labelWidth,
      flow: label.textFlow,
      measured: Boolean(currentTextMetrics(label)),
    };
    return {
      initial,
      unchangedOnReopen,
      changed,
      hugLabel,
      boldMeasured: Boolean(currentTextMetrics(text)),
      boldText: text.text,
      boldHeight: copy.height,
      nodes: documentValue.nodes.map((node) => ({
        type: node.type,
        positioning: node.layoutPositioning,
      })),
    };
  }, captured.document);
  assert.deepEqual(result.initial.wrapper, { layout: "vertical", height: 48, sizing: "hug" });
  assert.equal(result.initial.text.text.replaceAll("\n", ""), result.initial.text.textSource);
  assert.equal(result.initial.text.text.split("\n").length, 2);
  assert.equal(result.initial.text.layoutSizingHorizontal, "fill");
  assert.equal(result.initial.actionsY, 138);
  assert.equal(result.initial.measured, true);
  assert.equal(result.unchangedOnReopen, true);
  assert.equal(result.changed.text.text.replaceAll("\n", ""), result.changed.text.textSource);
  assert.ok(result.changed.height > result.initial.wrapper.height);
  assert.equal(
    result.changed.actionsY,
    result.changed.y + result.changed.height + result.changed.gap,
  );
  assert.equal(result.changed.measured, true);
  assert.equal(result.hugLabel.text, "Save changes");
  assert.equal(result.hugLabel.flow, undefined);
  assert.ok(result.hugLabel.width > result.hugLabel.previousWidth);
  assert.equal(result.hugLabel.measured, true);
  assert.equal(result.boldMeasured, true);
  assert.ok(result.boldHeight >= result.changed.height);
  assert.ok(result.nodes.every((node) => node.positioning !== "absolute"));
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("duplicate selectors retain exact plain-text source identity through width, height, content and reopen edits", async (t) => {
  const f = await fixture(t);
  const original =
    "Alpha\u00a0beta keeps its nonbreaking space and reflows across ordinary editable text containers without losing the original characters.";
  const edited =
    "Edited Alpha\u00a0beta keeps its nonbreaking space and grows the ordinary paragraph so following blocks move after every new measured line.";
  const rawSecond = "\n\tPlain ASCII source\n  whitespace remains separately available.\n ";
  const html = (copy, fixedHeight) =>
    `<!doctype html><style>*{box-sizing:border-box}body{margin:0;font:16px/24px Arial;color:#0f172a;background:white}#root{width:100%;height:440px;padding:20px;background:#e2e8f0}h2,p{margin:0}h2{font:700 20px/28px Arial}h2:nth-of-type(2){font:700 24px/32px Arial}p{font:16px/24px Arial;margin-bottom:12px}${fixedHeight ? `p:first-of-type{height:${fixedHeight}px}` : ""}</style><main id="root"><h2 class="title">Repeated title</h2><p class="copy">${copy}</p><h2 class="title">Repeated title</h2><p class="copy">${rawSecond}</p></main>`;
  const captured = await f.capture(html(original), {
    rootSelector: "#root",
    width: 640,
    height: 440,
  });
  const initial = normalizeDesignDocument(captured.document);
  const frames = initial.nodes.filter(
    (node) => node.type === "frame" && /^(h2|p)\./u.test(node.name),
  );
  assert.equal(frames.length, 4);
  assert(
    frames.every((node) => node.layout === "vertical"),
    JSON.stringify({
      frames: frames.map((node) => ({
        name: node.name,
        layout: node.layout,
        child: initial.nodes.find((n) => n.parentId === node.id),
      })),
      warnings: captured.report.warnings,
    }),
  );
  assert.equal(
    initial.nodes.length,
    11,
    "the existing upstream margin wrapper stays structural; text promotion adds no layers",
  );
  for (const frame of frames) {
    const children = initial.nodes.filter((node) => node.parentId === frame.id);
    assert.equal(children.length, 1);
    assert.equal(children[0].type, "text");
    assert.equal(children[0].layoutSizingHorizontal, "fill");
    assert.equal(children[0].layoutSizingVertical, "hug");
  }
  assert.equal(
    initial.nodes.find((node) => node.type === "text" && node.textSource === original).textSource,
    original,
  );
  const second = initial.nodes.find(
    (node) => node.type === "text" && node.textSource?.startsWith("Plain ASCII"),
  );
  assert.equal(JSON.parse(second.notes).htmlTextOriginal.rawSource, rawSecond);
  assert(!captured.report.warnings.some((warning) => warning.code === "html-text-source-binding"));
  for (const [width, copy, fixedHeight] of [
    [640, original],
    [400, original],
    [400, edited],
    [400, edited, 120],
  ]) {
    await f.page.setViewportSize({ width, height: 440 });
    await f.page.setContent(html(copy, fixedHeight));
    await f.page.evaluate(() => document.fonts.ready);
    const reference = PngImage.sync.read(await f.page.screenshot());
    const expected = await f.page.locator("h2,p").evaluateAll((elements) =>
      elements.map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
    const result = await f.page.evaluate(
      async ({ input, width, copy, fixedHeight, original }) => {
        const { normalizeDesignDocument, serializeDesignDocument, exportDesignSvg } =
          await import("/app/document.mjs");
        const { applyAllAutoLayouts } = await import("/app/layout.mjs");
        const value = normalizeDesignDocument(input);
        value.canvas.width = width;
        value.nodes.find((node) => node.id === "html-viewport").width = width;
        const text = value.nodes.find(
          (node) => node.type === "text" && node.textSource === original,
        );
        text.textSource = copy;
        if (fixedHeight) {
          const parent = value.nodes.find((node) => node.id === text.parentId);
          parent.layoutSizingVertical = "fixed";
          parent.height = fixedHeight;
        }
        applyAllAutoLayouts(value.nodes);
        const source = serializeDesignDocument(value),
          reopened = normalizeDesignDocument(JSON.parse(source));
        applyAllAutoLayouts(reopened.nodes);
        return {
          svg: exportDesignSvg(value),
          source: text.textSource,
          stable: source === serializeDesignDocument(reopened),
          frames: value.nodes
            .filter((node) => node.type === "frame" && /^(h2|p)\./u.test(node.name))
            .map(({ x, y, width, height, layout }) => ({ x, y, width, height, layout })),
          absolute: value.nodes.some((node) => node.layoutPositioning === "absolute"),
        };
      },
      { input: captured.document, width, copy, fixedHeight, original },
    );
    assert.equal(result.source, copy);
    assert.equal(result.stable, true);
    assert.equal(result.absolute, false);
    assert.deepEqual(
      result.frames.map(({ layout, ...box }) => box),
      expected,
    );
    await f.page.setContent(
      `<!doctype html><style>html,body{margin:0}svg{display:block}</style>${result.svg}`,
    );
    const converted = PngImage.sync.read(await f.page.screenshot());
    assert(
      reference.data.equals(converted.data),
      `strict pixels at width ${width}, fixedHeight ${fixedHeight ?? "auto"}`,
    );
  }
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("plain-text binding collisions and unsupported table, inline, pseudo and styled cases stay conservative", async (t) => {
  const f = await fixture(t);
  const html =
    '<!doctype html><style>body{margin:0;font:16px/24px Arial}.copy{margin:0}#root{height:500px}.table{display:table-cell}.inline{display:inline}.generated::before{content:"prefix"}.first::first-letter{font-size:30px}.spaced{word-spacing:3px}.rtl{direction:rtl}</style><main id="root"><p class="copy" data-semantic-id="collision">First collision</p><p class="copy" data-semantic-id="collision">Second collision</p><p id="table" class="table">Table cell</p><a id="inline" class="inline">Inline anchor</a><p id="generated" class="generated">Generated</p><p id="first" class="first">First letter</p><p id="spaced" class="spaced">Word spacing</p><p id="rtl" class="rtl">RTL source</p><p id="mixed">Mixed <strong>style</strong></p><p id="fallback-one" data-semantic-id="fallback">Unique selector one</p><p id="fallback-two" data-semantic-id="fallback">Unique selector two</p></main>';
  const captured = await f.capture(html, { rootSelector: "#root", width: 640, height: 400 });
  const doc = normalizeDesignDocument(captured.document);
  for (const id of ["table", "inline", "first", "spaced", "rtl"]) {
    assert.equal(byHtmlId(doc, id, "frame").layout, "none", id);
  }
  for (const id of ["generated", "mixed"]) {
    const frame = byHtmlId(doc, id, "frame");
    assert.notEqual(frame.layout, "vertical", id);
  }
  const collisions = doc.nodes.filter(
    (node) =>
      node.type === "frame" && JSON.parse(node.notes ?? "{}").semanticId?.endsWith("collision"),
  );
  assert.equal(collisions.length, 2);
  assert(collisions.every((node) => node.layout === "none"));
  assert.equal(
    captured.report.warnings.filter((warning) => warning.code === "html-text-source-binding")
      .length,
    4,
  );
  for (const id of ["fallback-one", "fallback-two"])
    assert.equal(byHtmlId(doc, id, "frame").layout, "vertical");
  assert(captured.report.warnings.some((warning) => warning.code === "html-plain-text-fixed"));
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("duplicate plain-text sources with first-line height or calculated indent keep measured fallback", async (t) => {
  const f = await fixture(t);
  const copy =
    "Ordinary paragraph source wraps across multiple lines while its first line retains the authored line box and indentation.";
  const cases = [
    { name: "first-line-height", rule: "p::first-line{line-height:48px}" },
    { name: "calculated-indent", rule: "p{text-indent:calc(5% + 2px)}" },
  ];
  for (const specimen of cases)
    for (const width of [640, 400]) {
      const html = `<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;background:white;font:16px/24px Arial}#root{width:100%;height:400px;padding:20px}p{margin:0}${specimen.rule}</style><main id="root"><p class="copy">${copy}</p><p class="copy">${copy}</p></main>`;
      await f.page.setViewportSize({ width, height: 400 });
      await f.page.setContent(html);
      await f.page.evaluate(() => document.fonts.ready);
      const sourceBoxes = await f.page.locator("p.copy").evaluateAll((elements) =>
        elements.map((element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x, y, width, height };
        }),
      );
      const captured = await f.capture(html, { rootSelector: "#root", width, height: 400 });
      const document = normalizeDesignDocument(captured.document);
      const frames = document.nodes.filter(
        (node) => node.type === "frame" && node.name === "p.copy",
      );
      assert.equal(frames.length, 2);
      assert(
        frames.every((node) => node.layout === "none"),
        `${specimen.name} width${width}`,
      );
      assert.equal(
        captured.report.warnings.filter(
          (warning) =>
            warning.code === "html-plain-text-fixed" &&
            frames.some((frame) => frame.id === warning.nodeId),
        ).length,
        2,
      );
      assert(
        !captured.report.warnings.some((warning) => warning.code === "html-text-source-binding"),
      );
      const boxes = () => frames.map(({ x, y, width, height }) => ({ x, y, width, height }));
      assert.deepEqual(boxes(), sourceBoxes, `${specimen.name} measured source geometry`);
      const initial = boxes();
      applyAllAutoLayouts(document.nodes);
      assert.deepEqual(
        boxes(),
        initial,
        `${specimen.name} must retain captured line boxes after reflow`,
      );
      const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(document)));
      applyAllAutoLayouts(reopened.nodes);
      assert.deepEqual(
        reopened.nodes
          .filter((node) => frames.some((frame) => frame.id === node.id))
          .map(({ x, y, width, height, layout }) => ({ x, y, width, height, layout })),
        initial.map((box) => ({ ...box, layout: "none" })),
      );
      // Unsupported typography already has a raster mismatch in the measured
      // fallback. This regression promises preservation/diagnostics, not fidelity.
    }
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("block text uses browser line breaks and moves following blocks after resize and source edits", async (t) => {
  const f = await fixture(t);
  const original = "Text wraps across ordinary block flow when the parent frame becomes narrower.";
  const edited = "Edited text wraps across ordinary block flow and keeps its following editable block below every new line without changing the frame width.";
  const html = (copy) => `<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;background:white;font:20px/24px Arial;color:#0f172a}#root{width:100%;height:320px;padding:20px;background:#e2e8f0}#card{padding:12px;background:white}h1,p{margin:0;font:20px/24px Arial}h1{margin-bottom:12px}p{margin-top:6px;margin-bottom:16px}#last{height:20px;background:#2563eb}</style><main id="root"><section id="card"><h1>Editable blocks</h1><p id="copy">${copy}</p><div id="last"></div></section></main>`;
  const captured = await f.capture(html(original), { rootSelector: "#root", width: 640, height: 320 });
  for (const [width, copy] of [[640, original], [400, original], [400, edited]]) {
    await f.page.setViewportSize({ width, height: 320 });
    await f.page.setContent(html(copy));
    await f.page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const source = PngImage.sync.read(await f.page.screenshot());
    const expectedY = await f.page.locator("#last").evaluate((element) => element.getBoundingClientRect().y);
    const result = await f.page.evaluate(async ({ input, width, copy }) => {
      const { normalizeDesignDocument, serializeDesignDocument, exportDesignSvg } = await import("/app/document.mjs");
      const { applyAllAutoLayouts } = await import("/app/layout.mjs");
      const value = normalizeDesignDocument(input);
      const byId = (id, type = "frame") => value.nodes.find((node) =>
        node.type === type && JSON.parse(node.notes ?? "{}").attributes?.id === id);
      value.canvas.width = width;
      value.nodes.find((node) => node.id === "html-viewport").width = width;
      byId("root").width = width;
      const text = byId("copy", "text");
      text.textSource = copy;
      applyAllAutoLayouts(value.nodes);
      const saved = serializeDesignDocument(value);
      const reopened = normalizeDesignDocument(JSON.parse(saved));
      applyAllAutoLayouts(reopened.nodes);
      return {
        svg: exportDesignSvg(value), text: text.text, source: text.textSource,
        lastY: byId("last").y, stable: saved === serializeDesignDocument(reopened),
        layout: byId("card").layout,
        absolute: value.nodes.some((node) => node.layoutPositioning === "absolute"),
      };
    }, { input: captured.document, width, copy });
    assert.equal(result.layout, "vertical");
    assert.equal(result.absolute, false);
    assert.equal(result.text.replaceAll("\n", ""), copy);
    assert.equal(result.source, copy);
    assert.equal(result.lastY, expectedY);
    assert.equal(result.stable, true);
    await f.page.setContent(`<!doctype html><style>html,body{margin:0}svg{display:block}</style>${result.svg}`);
    const converted = PngImage.sync.read(await f.page.screenshot());
    let changed = 0;
    for (let offset = 0; offset < source.data.length; offset += 4)
      if (source.data.subarray(offset, offset + 4).compare(converted.data.subarray(offset, offset + 4))) changed++;
    assert.equal(changed, 0, `${width}px ${copy === edited ? "edited" : "original"} pixels`);
  }
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("actual HTML capture imports editable v3, survives editing and a complete file, then the Figma plugin restores exact local assets", async (t) => {
  const f = await fixture(t);
  const html = `<!doctype html><title>End-to-end HTML</title><style>body{margin:0;font-family:Arial}.card{position:relative;width:400px;height:280px;background:#eef4ff}h1{margin:0;position:absolute;left:20px;top:20px;font-size:28px}img{position:absolute;left:20px;top:90px;width:24px;height:24px}svg{position:absolute;left:70px;top:90px}</style><main class="card" data-component="Card"><h1 id="heading">Original HTML title</h1><img src="data:image/png;base64,${PNG}" alt="Offline PNG"><svg width="20" height="20" viewBox="0 0 20 20"><rect width="20" height="20" fill="blue"/></svg></main>`;
  const result = await f.capture(html),
    repeated = await f.capture(html);
  assert.equal(result.report.engine, "html2figma");
  assert.equal(result.report.upstreamCommit, "ea78385c7ab8cb251d5f0cc10213dea4a93e9a7c");
  assert.equal(result.document.version, 3);
  assert.ok(result.resourcePlans.length >= 2, "PNG and SVG must be local resources");
  const document = normalizeDesignDocument(result.document),
    again = normalizeDesignDocument(repeated.document);
  assert.equal(new Set(document.nodes.map((node) => node.id)).size, document.nodes.length);
  assert.deepEqual(
    document.nodes.map((node) => node.id),
    again.nodes.map((node) => node.id),
    "random upstream ids must not alter persistent design ids",
  );
  assert.deepEqual(
    result.mapping.map((entry) => entry.designId),
    repeated.mapping.map((entry) => entry.designId),
  );
  const heading = document.nodes.find(
    (node) => node.type === "text" && node.text === "Original HTML title",
  );
  assert.ok(heading, "HTML text must remain editable text");
  heading.text = "Edited after HTML import";
  heading.fill = "#123456";
  const edited = normalizeDesignDocument(JSON.parse(serializeDesignDocument(document)));
  assert.equal(edited.nodes.find((node) => node.id === heading.id).text, heading.text);

  const files = new Map(
    result.resourcePlans.flatMap((plan) => plan.parts.map((part) => [part.path, part.content])),
  );
  const portable = await createPortableDesign({
    document: edited,
    source: {
      workspaceRoot: "/fixture",
      sessionId: "html-import",
      path: "designs/html.codesign.json",
    },
    readText: async (path) => {
      if (!files.has(path)) throw Error("missing");
      return files.get(path);
    },
    sha256Bytes: hash,
  });
  const backup = JSON.parse(portable);
  assert.equal(backup.resources.length, edited.resources.length);
  const reopened = await planPortableDesign(portable, { sha256: hash, sha256Bytes: hash });
  assert.equal(
    normalizeDesignDocument(JSON.parse(reopened.primarySource)).nodes.find(
      (node) => node.id === heading.id,
    ).text,
    heading.text,
  );
  files.clear();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error("The Figma converter must use only the complete file");
  };
  let prepared;
  try {
    prepared = await preparePluginFile(portable, { sha256Bytes: hash });
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(prepared.kind, "portable");
  assert.equal(prepared.transfer.format, "codeshell.figma.transfer");
  assert.equal(prepared.summary.images, edited.resources.length);
  const exported = allTransferNodes(prepared.transfer);
  assert.equal(exported.find((node) => node.id === heading.id).text, heading.text);
  assert.equal(exported.find((node) => node.id === heading.id).fill, "#123456");
  assert.equal(new Set(exported.map((node) => node.id)).size, exported.length);
  for (const resource of backup.resources)
    assert.equal(prepared.transfer.assets[resource.id].base64, resource.base64);
  const damaged = structuredClone(backup);
  damaged.resources[0].base64 = "AA==";
  await assert.rejects(
    () => preparePluginFile(JSON.stringify(damaged), { sha256Bytes: hash }),
    /校验|资源/u,
  );
  const missing = structuredClone(backup);
  missing.resources.pop();
  await assert.rejects(
    () => preparePluginFile(JSON.stringify(missing), { sha256Bytes: hash }),
    /资源/u,
  );
  await assert.rejects(
    () => preparePluginFile(serializeDesignDocument(edited), { sha256Bytes: hash }),
    /普通 v3|完整备份/u,
  );
  assert.equal(result.remainingFrames, 0);
  assert.equal(result.parentMarker, "Parent stays intact");
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("workspace CSS and selected local image bytes resolve under their own paths and responsive viewports retain measured layout", async (t) => {
  const f = await fixture(t);
  const html =
    '<!doctype html><link rel="stylesheet" href="../styles/main.css"><main id="responsive"><div class="tiles"><section id="first" class="tile">First</section><section id="second" class="tile">Second</section></div><img id="local-photo" src="../assets/pixel.png"><div class="background-photo"></div></main>';
  const css =
    'body{margin:0;font:16px Arial}#responsive{width:100vw;padding:16px;box-sizing:border-box}.tiles{display:flex;gap:16px}.tile{width:calc((100vw - 48px)/2);height:40px;flex-shrink:0;background:#ddeeff}img{width:12px;height:12px}.background-photo{width:12px;height:12px;background-image:url("../assets/pixel.png")}@media(max-width:400px){.tiles{flex-direction:column}.tile{width:100%}}';
  const options = {
    textFiles: { "styles/main.css": css },
    assetFiles: { "assets/pixel.png": { base64: PNG } },
    rootSelector: "#responsive",
  };
  const wide = await f.capture(html, { ...options, width: 480 }),
    narrow = await f.capture(html, { ...options, width: 320 });
  assert.deepEqual(wide.textReads, ["styles/main.css"]);
  assert.deepEqual(
    wide.assetReads,
    ["assets/pixel.png"],
    "CSS and img references share the same bounded local resolver cache",
  );
  assert.ok(wide.resourcePlans.length >= 1);
  assert.deepEqual(wide.document.canvas, { width: 480, height: 360, background: "#ffffff" });
  assert.deepEqual(narrow.document.canvas, { width: 320, height: 360, background: "#ffffff" });
  const wideDocument = normalizeDesignDocument(wide.document),
    narrowDocument = normalizeDesignDocument(narrow.document);
  const firstWide = byHtmlId(wideDocument, "first", "frame"),
    secondWide = byHtmlId(wideDocument, "second", "frame");
  const firstNarrow = byHtmlId(narrowDocument, "first", "frame"),
    secondNarrow = byHtmlId(narrowDocument, "second", "frame");
  assert.ok(firstWide && secondWide && firstNarrow && secondNarrow);
  assert.ok(secondWide.x > firstWide.x && Math.abs(secondWide.y - firstWide.y) < 1);
  assert.ok(secondNarrow.y > firstNarrow.y && Math.abs(secondNarrow.x - firstNarrow.x) < 1);
  assert.equal(firstWide.width, 216);
  assert.equal(firstNarrow.width, 288);
  assert.deepEqual(
    wideDocument.nodes.map((node) => node.id),
    narrowDocument.nodes.map((node) => node.id),
  );
  assert.equal(wide.remainingFrames, 0);
  assert.equal(narrow.remainingFrames, 0);
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("production HTML text uses measured hanging baselines across fonts, sizes and line heights", async (t) => {
  const f = await fixture(t);
  await f.page.setViewportSize({ width: 480, height: 360 });
  const html = `<!doctype html><style>
    *{box-sizing:border-box}html,body{margin:0;background:#fff;color:#172033;font-family:Arial}
    main{width:480px;height:360px;padding:20px}h1,p{margin:0 0 12px}
    h1{font-size:24px;line-height:30px}p{font-size:16px;line-height:24px}
    .label{display:inline-block;padding:6px 12px;background:#dbeafe;font-size:14px;line-height:20px}
    .serif{font-family:"Times New Roman";font-style:italic;font-size:20px;line-height:28px;margin-top:12px}
    .mono{font-family:monospace;font-size:18px;line-height:24px}
    </style><main><h1>Heading baseline</h1><p>Paragraph baseline</p><span class="label">Button label</span><p class="serif">Italic glyphs gjpq</p><p class="mono">Monospace baseline</p></main>`;
  await f.page.setContent(html);
  await f.page.evaluate(() => document.fonts.ready);
  const source = PngImage.sync.read(await f.page.screenshot());
  const captured = await f.capture(html);
  const saved = serializeDesignDocument(normalizeDesignDocument(captured.document));
  const nodes = normalizeDesignDocument(JSON.parse(saved)).nodes.filter(
    (node) => node.type === "text",
  );
  assert.equal(nodes.length, 5);
  const svg = await f.page.evaluate(async (value) => {
    const { normalizeDesignDocument, exportDesignSvg } = await import("/app/document.mjs");
    return exportDesignSvg(normalizeDesignDocument(JSON.parse(value)));
  }, saved);
  await f.page.setContent(
    `<!doctype html><style>html,body{margin:0;background:#fff}svg{display:block}</style>${svg}`,
  );
  await f.page.evaluate(() => document.fonts.ready);
  const converted = PngImage.sync.read(await f.page.screenshot());
  let changed = 0,
    exactChanged = 0;
  for (let pixel = 0; pixel < source.width * source.height; pixel++) {
    const offset = pixel * 4;
    const delta = Math.max(
      ...[0, 1, 2].map((channel) =>
        Math.abs(source.data[offset + channel] - converted.data[offset + channel]),
      ),
    );
    if (delta > 0) exactChanged++;
    if (delta > 24) changed++;
  }
  t.diagnostic(
    `${exactChanged}/${source.width * source.height} pixels differ exactly; ${changed} differ by more than 24 channel levels`,
  );
  assert(
    changed / (source.width * source.height) < 0.005,
    `text baseline drift changed ${changed} pixels`,
  );
  const inkBounds = (image, top, bottom) => {
    const rows = [];
    for (let y = top; y < bottom; y++) {
      for (let x = 0; x < image.width; x++) {
        const offset = (y * image.width + x) * 4;
        if (Math.max(...image.data.subarray(offset, offset + 3)) < 128) {
          rows.push(y);
          break;
        }
      }
    }
    return [rows[0], rows.at(-1)];
  };
  for (const [top, bottom] of [
    [20, 50],
    [62, 86],
    [104, 128],
    [136, 164],
    [176, 200],
  ])
    assert.deepEqual(
      inkBounds(converted, top, bottom),
      inkBounds(source, top, bottom),
      `ink rows at ${top}–${bottom}`,
    );
  assert(nodes.every((node) => Number.isFinite(node.layoutBaselineOffset)));
  assert(
    new Set(nodes.map((node) => node.layoutBaselineOffset)).size > 1,
    "offsets must follow the active font metrics",
  );
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("translucent CSS card headers keep light backgrounds and readable editable text in real pixels", async (t) => {
  const f = await fixture(t);
  await f.page.setViewportSize({ width: 480, height: 360 });
  const html = `<!doctype html><style>
    *{box-sizing:border-box}html,body{margin:0;font-family:Arial;color:#212529;background:#fff}
    main{width:480px;height:360px;padding:20px}.card{display:flex;flex-direction:column;width:400px;height:220px;background:#fff}
    header{display:flex;flex-direction:column;padding:16px;background:rgba(33,37,41,.03)}
    h4{margin:0;font-size:24px;font-weight:400;line-height:30px}
    p{margin:0;padding:16px;font-size:16px;line-height:24px;color:rgba(33,37,41,.75)}
    </style><main><section class="card"><header id="header"><h4>Free plan</h4></header><p id="description">Editable translucent copy</p></section></main>`;
  await f.page.setContent(html);
  await f.page.evaluate(() => document.fonts.ready);
  const source = PngImage.sync.read(await f.page.screenshot());
  const captured = await f.capture(html);
  const document = normalizeDesignDocument(captured.document);
  const header = byHtmlId(document, "header", "frame");
  assert.deepEqual(header.fillPaints, [{ type: "SOLID", color: "#212529", opacity: 0.03 }]);
  assert(document.nodes.some((node) => node.type === "text" && node.text === "Free plan"));
  assert(
    document.nodes.some(
      (node) =>
        node.type === "text" &&
        node.text === "Editable translucent copy" &&
        node.fillPaints?.[0].opacity === 0.75,
    ),
  );
  const svg = await f.page.evaluate(async (value) => {
    const { exportDesignSvg, normalizeDesignDocument } = await import("/app/document.mjs");
    return exportDesignSvg(normalizeDesignDocument(value));
  }, captured.document);
  await f.page.setContent(
    `<!doctype html><style>html,body{margin:0;background:#fff}svg{display:block}</style>${svg}`,
  );
  await f.page.evaluate(() => document.fonts.ready);
  await f.page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const rendered = PngImage.sync.read(await f.page.screenshot());
  let changed = 0;
  for (let offset = 0; offset < source.data.length; offset += 4)
    if (
      [0, 1, 2, 3].some(
        (channel) => source.data[offset + channel] !== rendered.data[offset + channel],
      )
    )
      changed++;
  assert.equal(
    changed,
    0,
    "CSS fill alpha must match every source RGBA pixel without flattening text",
  );
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("production CSS linear gradients preserve 100px stops, angles, transparent overlays and layer order through portable files and the real plugin UI", async (t) => {
  const f = await fixture(t);
  await f.page.setViewportSize({ width: 480, height: 360 });
  const html = `<!doctype html><style>
    *{box-sizing:border-box}html,body{margin:0;background:#fff}
    main{display:flex;flex-direction:column;width:480px;height:360px;background:linear-gradient(#ddd,white 100px)}
    .row{display:flex;flex:none;width:480px;height:100px}.tile{flex:none;width:240px;height:100px}
    #angle{background:linear-gradient(45deg,#123456,#abcdef)}
    #corner{background:linear-gradient(to bottom right,#eee,#555)}
    #fade{background:linear-gradient(90deg,rgba(255,0,0,.4) 0% 50%,transparent 50% 100%) #0000ff}
    #layers{background:linear-gradient(90deg,rgba(0,255,0,.4) 0% 50%,transparent 50% 100%),linear-gradient(#f00 0% 50%,#00f 50% 100%) #fff}
    .spacer{height:120px;flex:none}
    </style><main id="gradients"><div class="spacer"></div><div class="row"><div id="angle" class="tile"></div><div id="corner" class="tile"></div></div><div class="row"><div id="fade" class="tile"></div><div id="layers" class="tile"></div></div></main>`;
  await f.page.setContent(html);
  const source = PngImage.sync.read(await f.page.screenshot());
  const captured = await f.capture(html, { rootSelector: "#gradients" });
  const design = normalizeDesignDocument(captured.document);
  const root = byHtmlId(design, "gradients");
  assert.equal(root.layout, "vertical");
  assert.equal(root.fillPaints[0].stops[1].position, 100 / 360);
  assert.equal(captured.resourcePlans.length, 0, "editable paints must not create image assets");
  assert.equal(design.nodes.some((node) => node.type === "image" || node.layoutPositioning === "absolute"), false);
  assert.equal(captured.report.warnings.some((warning) => /gradient|multiple-backgrounds/u.test(warning.code)), false);
  const before = design.nodes.map(({ x, y, width, height }) => [x, y, width, height]);
  applyAllAutoLayouts(design.nodes);
  assert.deepEqual(design.nodes.map(({ x, y, width, height }) => [x, y, width, height]), before);
  const portable = await createPortableDesign({ document: design, source: {
    workspaceRoot: "/gradient-fixture", sessionId: "gradients", path: "designs/gradients.codesign.json",
  }, readText: async () => undefined, sha256Bytes: hash });
  await planPortableDesign(portable, { sha256Bytes: hash });
  const reopened = normalizeDesignDocument(JSON.parse(portable).document);
  assert.deepEqual(reopened.nodes.map((node) => node.fillPaints), design.nodes.map((node) => node.fillPaints));
  const svg = await f.page.evaluate(async (value) => {
    const { exportDesignSvg, normalizeDesignDocument } = await import("/app/document.mjs");
    return exportDesignSvg(normalizeDesignDocument(value));
  }, JSON.parse(portable).document);
  await f.page.setContent(`<!doctype html><style>html,body{margin:0;background:#fff}svg{display:block}</style>${svg}`);
  const rendered = PngImage.sync.read(await f.page.screenshot());
  let changed = 0;
  for (let offset = 0; offset < source.data.length; offset += 4)
    if ([0, 1, 2, 3].some((channel) => source.data[offset + channel] !== rendered.data[offset + channel])) changed++;
  assert.equal(changed, 0, "every source RGBA pixel must survive CSS → v3 → portable → SVG");

  await f.page.evaluate(() => {
    window.gradientPluginRequests = [];
    addEventListener("message", (event) => {
      if (event.data?.pluginMessage?.type === "import-transfer") window.gradientPluginRequests.push(event.data.pluginMessage);
    });
    document.body.innerHTML = '<iframe id="bridge" src="/bridge-ui.html" sandbox="allow-scripts allow-downloads" style="width:420px;height:600px"></iframe>';
  });
  const ui = f.page.frameLocator("#bridge");
  await ui.locator("#paste-transfer-details summary").click();
  await ui.locator("#paste-json").fill(portable);
  await ui.locator("#load-pasted-json").click();
  await ui.locator("body[aria-busy=false]").waitFor();
  await ui.locator("#import").click();
  await f.page.waitForFunction(() => window.gradientPluginRequests.length === 1);
  const transfer = JSON.parse(await f.page.evaluate(() => window.gradientPluginRequests[0].content));
  assert.deepEqual(transfer.assets, {});
  const prepared = await preparePluginFile(portable, { sha256Bytes: hash });
  assert.deepEqual(transfer, prepared.transfer);
  for (const node of allTransferNodes(transfer)) {
    const original = reopened.nodes.find((entry) => entry.id === node.id);
    assert.deepEqual(node.fillPaints, original.fillPaints);
  }
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("unsupported computed CSS gradients produce actionable diagnostics and retain only their independent solid base", async (t) => {
  const f = await fixture(t);
  for (const image of ["radial-gradient(red,blue)", "conic-gradient(red,blue)",
    "repeating-linear-gradient(red,blue 20px)", "linear-gradient(rgba(255,0,0,.5),rgba(0,0,255,.75))"]) {
    const result = await f.capture(`<style>body{margin:0}main{width:480px;height:360px;background-color:#123456;background-image:${image}}</style><main id="unsupported"></main>`, { rootSelector: "main" });
    const node = byHtmlId(normalizeDesignDocument(result.document), "unsupported");
    assert.equal(node.fill, "#123456");
    assert.equal(node.fillPaints, undefined);
    assert(result.report.warnings.some((warning) => warning.code === "unsupported-css-gradient"), image);
  }
});

test("same-document SVG symbols and use chains remain standalone through pixels, portable files and the production plugin UI", async (t) => {
  const f = await fixture(t);
  await f.page.setViewportSize({ width: 480, height: 360 });
  const html = `<!doctype html><style>html,body{margin:0;background:#fff}main{display:flex;gap:16px;padding:20px;box-sizing:border-box;width:480px;height:360px}main svg{display:block;flex:none;fill:currentColor}</style>
    <svg style="display:none"><symbol id="check" viewBox="0 0 16 16"><path d="M2 8L6 12L14 3L12 2L6 9L3 6Z" fill="currentColor"/></symbol><symbol id="alias" viewBox="0 0 16 16"><use href="#check"/></symbol></svg>
    <main id="icons"><svg width="24" height="24" style="color:#0d6efd"><use href="#alias"/></svg><svg width="24" height="24" style="color:#dc3545"><use xlink:href="#check"/></svg></main>`;
  await f.page.setContent(html);
  const source = PngImage.sync.read(await f.page.screenshot());
  const captured = await f.capture(html, { rootSelector: "#icons" });
  const document = normalizeDesignDocument(captured.document);
  assert.equal(document.nodes.filter((node) => node.type === "image").length, 2);
  assert.equal(
    document.nodes.some((node) => node.layoutPositioning === "absolute"),
    false,
  );
  const files = new Map(
    captured.resourcePlans.flatMap((plan) => plan.parts.map((part) => [part.path, part.content])),
  );
  const portable = await createPortableDesign({
    document,
    source: {
      workspaceRoot: "/svg-fixture",
      sessionId: "svg",
      path: "designs/icons.codesign.json",
    },
    readText: async (path) => files.get(path),
    sha256Bytes: hash,
  });
  const prepared = await preparePluginFile(portable, { sha256Bytes: hash });
  const svgAssets = Object.values(prepared.transfer.assets);
  assert.equal(svgAssets.length, 2);
  assert(svgAssets.every((asset) => asset.mime === "image/svg+xml"));
  const dataUrls = Object.fromEntries(
    Object.entries(prepared.transfer.assets).map(([id, asset]) => [
      id,
      `data:${asset.mime};base64,${asset.base64}`,
    ]),
  );
  for (const asset of svgAssets) {
    const xml = Buffer.from(asset.base64, "base64").toString("utf8");
    assert.match(xml, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/u);
    assert.match(xml, /id="check"/u);
  }
  const svg = await f.page.evaluate(
    async ({ document, dataUrls }) => {
      const { normalizeDesignDocument, exportDesignSvg } = await import("/app/document.mjs");
      await Promise.all(
        Object.values(dataUrls).map(async (dataUrl) => {
          const image = new Image();
          image.src = dataUrl;
          await image.decode();
        }),
      );
      return exportDesignSvg(normalizeDesignDocument(document), {
        resourceDataUrls: new Map(Object.entries(dataUrls)),
      });
    },
    { document: captured.document, dataUrls },
  );
  await f.page.setContent(
    `<!doctype html><style>html,body{margin:0;background:#fff}svg{display:block}</style>${svg}`,
  );
  await f.page.evaluate(async () => {
    await Promise.all([...document.images].map((image) => image.decode()));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const rendered = PngImage.sync.read(await f.page.screenshot());
  let changed = 0;
  for (let offset = 0; offset < source.data.length; offset += 4)
    if (
      [0, 1, 2, 3].some(
        (channel) => source.data[offset + channel] !== rendered.data[offset + channel],
      )
    )
      changed++;
  assert.equal(changed, 0, "self-contained symbol resources must preserve every source RGBA pixel");

  await f.page.evaluate(() => {
    window.svgPluginRequests = [];
    addEventListener("message", (event) => {
      if (event.data?.pluginMessage?.type === "import-transfer")
        window.svgPluginRequests.push(event.data.pluginMessage);
    });
    document.body.innerHTML =
      '<iframe id="bridge" src="/bridge-ui.html" sandbox="allow-scripts allow-downloads" style="width:420px;height:600px"></iframe>';
  });
  const ui = f.page.frameLocator("#bridge");
  await ui.locator("#paste-transfer-details summary").click();
  await ui.locator("#paste-json").fill(portable);
  await ui.locator("#load-pasted-json").click();
  await ui.locator("body[aria-busy=false]").waitFor();
  assert.equal(await ui.locator("#import").isEnabled(), true);
  await ui.locator("#import").click();
  await f.page.waitForFunction(() => window.svgPluginRequests.length === 1);
  const transfer = JSON.parse(await f.page.evaluate(() => window.svgPluginRequests[0].content));
  for (const asset of Object.values(transfer.assets)) {
    assert.equal(asset.mime, "image/png");
    const pixels = PngImage.sync.read(Buffer.from(asset.base64, "base64"));
    assert([...pixels.data].some((value, index) => index % 4 === 3 && value > 0));
  }
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("class-driven inner SVG opacity preserves group compositing and applies root opacity once", async (t) => {
  const f = await fixture(t);
  await f.page.setViewportSize({ width: 480, height: 360 });
  const html = `<!doctype html><style>html,body{margin:0;background:#fff}main{display:flex;gap:16px;padding:20px;box-sizing:border-box;width:480px;height:360px}main svg{display:block;flex:none;fill:currentColor;color:#0d6efd}.muted,.root-opacity{opacity:.5}</style>
    <svg style="display:none"><symbol id="tile" viewBox="0 0 24 24"><g class="muted"><path d="M0 0H24V24H0Z" fill="currentColor"/></g></symbol></svg>
    <main id="icons"><svg id="group" class="root-opacity" width="24" height="24"><g class="muted"><rect width="16" height="24" fill="red"/><rect x="8" width="16" height="24" fill="blue"/></g></svg><svg id="path" width="24" height="24" style="opacity:.5"><path class="muted" d="M0 0H24V24H0Z"/></svg><svg id="use" width="24" height="24" opacity=".5"><use class="muted" href="#tile"/></svg><svg id="definition" width="24" height="24"><use href="#tile"/></svg></main>`;
  await f.page.setContent(html);
  const source = PngImage.sync.read(await f.page.screenshot());
  const captured = await f.capture(html, { rootSelector: "#icons" });
  const document = normalizeDesignDocument(captured.document);
  assert.deepEqual(
    ["group", "path", "use", "definition"].map((id) => byHtmlId(document, id, "image").opacity),
    [0.5, 0.5, 0.5, 1],
  );
  const files = new Map(
    captured.resourcePlans.flatMap((plan) => plan.parts.map((part) => [part.path, part.content])),
  );
  const portable = await createPortableDesign({
    document,
    source: { workspaceRoot: "/svg-opacity", sessionId: "svg", path: "opacity.codesign.json" },
    readText: async (path) => files.get(path),
    sha256Bytes: hash,
  });
  const prepared = await preparePluginFile(portable, { sha256Bytes: hash });
  const dataUrls = Object.fromEntries(
    Object.entries(prepared.transfer.assets).map(([id, asset]) => [
      id,
      `data:${asset.mime};base64,${asset.base64}`,
    ]),
  );
  const svg = await f.page.evaluate(
    async ({ document, dataUrls }) => {
      const { normalizeDesignDocument, exportDesignSvg } = await import("/app/document.mjs");
      await Promise.all(
        Object.values(dataUrls).map(async (dataUrl) => {
          const image = new Image();
          image.src = dataUrl;
          await image.decode();
        }),
      );
      return exportDesignSvg(normalizeDesignDocument(document), {
        resourceDataUrls: new Map(Object.entries(dataUrls)),
      });
    },
    { document: captured.document, dataUrls },
  );
  await f.page.setContent(
    `<!doctype html><style>html,body{margin:0;background:#fff}svg{display:block}</style>${svg}`,
  );
  await f.page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const rendered = PngImage.sync.read(await f.page.screenshot());
  let changed = 0;
  for (let offset = 0; offset < source.data.length; offset += 4)
    if (
      [0, 1, 2, 3].some(
        (channel) => source.data[offset + channel] !== rendered.data[offset + channel],
      )
    )
      changed++;
  assert.equal(
    changed,
    0,
    "inner SVG opacity and root layer opacity must preserve every source RGBA pixel",
  );
  for (const asset of Object.values(prepared.transfer.assets)) {
    const xml = Buffer.from(asset.base64, "base64").toString("utf8");
    const root = xml.match(/^<svg\b[^>]*>/u)[0];
    assert.doesNotMatch(
      root,
      /(?:\s|;)opacity\s*[=:]/u,
      "root opacity belongs only to the editable v3 node",
    );
  }
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("SVG missing, cyclic, external and excessive local reference graphs fail before a partial import", async (t) => {
  const f = await fixture(t);
  const cases = [
    ['<svg width="24" height="24"><use href="#missing"/></svg>', /SVG 缺少/u],
    [
      '<svg style="display:none"><symbol id="a"><use href="#b"/></symbol><symbol id="b"><use href="#a"/></symbol></svg><svg width="24" height="24"><use href="#a"/></svg>',
      /SVG 引用包含循环/u,
    ],
    [
      '<svg width="24" height="24"><use href="https://untrusted.test/icons.svg#check"/></svg>',
      /SVG use 缺少/u,
    ],
    [
      '<svg width="24" height="24"><rect width="24" height="24" fill="url(https://untrusted.test/paint.svg#p)"/></svg>',
      /同一文档内/u,
    ],
    [
      `<svg style="display:none">${Array.from({ length: 35 }, (_, index) => `<symbol id="s${index}">${index === 34 ? '<rect width="24" height="24"/>' : `<use href="#s${index + 1}"/>`}</symbol>`).join("")}</svg><svg width="24" height="24"><use href="#s0"/></svg>`,
      /32 层引用链/u,
    ],
    [
      `<svg style="display:none">${Array.from({ length: 257 }, (_, index) => `<symbol id="s${index}"><rect width="24" height="24"/></symbol>`).join("")}</svg><svg width="24" height="24">${Array.from({ length: 257 }, (_, index) => `<use href="#s${index}"/>`).join("")}</svg>`,
      /256 项引用/u,
    ],
    [
      `<svg width="24" height="24">${'<rect width="1" height="1"/>'.repeat(2000)}</svg>`,
      /2000 个元素/u,
    ],
    [
      '<svg width="24" height="24"><foreignObject><div>Active foreign HTML</div></foreignObject></svg>',
      /SVG 不允许 foreignObject/u,
    ],
  ];
  for (const [source, expected] of cases) {
    await assert.rejects(() => f.capture(`<!doctype html>${source}`), expected);
    assert.equal(await f.page.locator("iframe").count(), 0);
  }
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("actual HTML import blocks scripts, handlers, navigations and remote resources while reporting blocked assets", async (t) => {
  const f = await fixture(t);
  const html = `<!doctype html><base href="https://leak.test/"><meta http-equiv="refresh" content="0;url=https://leak.test/navigation"><link rel="stylesheet" href="https://leak.test/external.css"><style>@import "https://leak.test/import.css";body{margin:0}.remote{width:30px;height:30px;background-image:url(https://leak.test/background)}</style><script>parent.importPwned=1;fetch('https://leak.test/script')</script><iframe src="https://leak.test/frame"></iframe><main style="width:300px;height:160px"><p onclick="parent.importPwned=2">Safe text</p><img src="https://leak.test/image" onerror="parent.importPwned=3"><div class="remote"></div><form action="https://leak.test/form"><input value="Static form"></form><img src="data:image/png;base64,${PNG}" onload="parent.importPwned=4" width="12" height="12"></main>`;
  const result = await f.capture(html);
  assert.equal(result.inputScriptRan, null);
  assert.equal(result.parentMarker, "Parent stays intact");
  assert.equal(result.remainingFrames, 0);
  assert.ok(result.report.warnings.some((warning) => warning.code === "external-resource-blocked"));
  const nodes = normalizeDesignDocument(result.document).nodes;
  assert.ok(nodes.some((node) => node.type === "text" && node.text === "Safe text"));
  assert.ok(nodes.some((node) => node.type === "text" && node.text === "Static form"));
  assert.ok(!nodes.some((node) => node.type === "text" && node.text.includes("importPwned")));
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});

test("missing local CSS or image data and undecodable inline images fail before a partial design can be returned", async (t) => {
  const f = await fixture(t);
  const cases = [
    {
      html: '<main><img src="../assets/missing.png"></main>',
      options: {},
      expected: /本地二进制资源|文件夹/u,
    },
    {
      html: '<main><img src="../assets/missing.png"></main>',
      options: { assetFiles: {} },
      expected: /没有受支持|资源/u,
    },
    {
      html: '<link rel="stylesheet" href="../styles/missing.css"><main>Missing CSS</main>',
      options: {},
      expected: /无法读取 HTML 样式表/u,
    },
    {
      html: '<main><img src="data:image/png;base64,YmFk" width="12" height="12"></main>',
      options: {},
      expected: /图片无法解码/u,
    },
  ];
  for (const item of cases) {
    await assert.rejects(() => f.capture(item.html, item.options), item.expected);
    assert.equal(await f.page.locator("iframe").count(), 0);
  }
  assert.deepEqual(f.external, []);
  assert.deepEqual(f.errors, []);
});
