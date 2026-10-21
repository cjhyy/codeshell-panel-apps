import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { runProductionFidelity, comparePixels } from "../../../scripts/design-studio-production-fidelity.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";

// The production runner shares this Playwright object. Keep every browser in
// this CPU fixture out of the graphics service, including its internal launch.
const launch = chromium.launch.bind(chromium);
chromium.launch = (options = {}) => launch({ ...options, args: [...(options.args ?? []), "--disable-gpu"] });

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/design-studio/app");
const css = "#fixture{display:flex;flex-direction:column;width:100%;height:240px;padding:20px;gap:12px;background:#e2e8f0}#header{position:relative;background:white}#status{position:absolute;top:0;left:0;width:1px;height:1px;overflow:hidden;clip:rect(1px,1px,1px,1px)}#languages{height:30px;background:#2563eb}#navigation{position:relative;z-index:2;height:60px;background:#f97316}#after{height:20px;background:#16a34a}";
const html = (content = "") => `<main id="fixture"><header id="header"><span id="status" role="status" aria-live="polite">${content}</span><nav id="languages"></nav><nav id="navigation"></nav></header><section id="after"></section></main>`;
const byId = (value, id) => value.nodes.find((node) => {
  try { return JSON.parse(node.notes).attributes?.id === id; } catch { return false; }
});
const treeNodes = (transfer) => {
  const nodes = [], visit = (node) => { nodes.push(node); node.children?.forEach(visit); };
  transfer.pages.forEach((page) => page.children.forEach(visit));
  return nodes;
};

test("empty actual absolute status nodes preserve source identity while relative z-index siblings regain Fill flow", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-empty-overlay-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const cases = ["", "<!-- empty comment -->", " \n\t "].map((content, index) => ({ id: `empty-${index}`, css, html: html(content) }));
  const report = await runProductionFidelity({ output, cases, resizeMode: "viewport-only", recordOnly: true });
  for (const observed of report.cases) {
    assert.deepEqual(observed.comparisons.map((item) => item.changedPixels), [0, 0, 0], JSON.stringify(observed));
    assert.deepEqual(observed.semanticIssues, []);
    for (const [mode, width] of [["imported", 640], ["narrow", 400]]) {
      const value = normalizeDesignDocument(JSON.parse(await readFile(join(output, observed.id, `${mode}.codesign.json`))));
      const header = byId(value, "header"), status = byId(value, "status"), languages = byId(value, "languages"), navigation = byId(value, "navigation");
      assert.equal(header.layout, "vertical");
      assert.equal(header.layoutSizingVertical, "hug");
      assert.deepEqual([header.x, header.y, header.width, header.height], [20, 20, width - 40, 90]);
      assert.deepEqual([languages.layoutSizingHorizontal, navigation.layoutSizingHorizontal], ["fill", "fill"]);
      assert.equal(navigation.layoutPositioning ?? "auto", "auto");
      assert.equal(status.layoutPositioning, "absolute", "the real status node never becomes an ordinary flow item");
      assert.deepEqual([status.x, status.y, status.width, status.height, status.visible], [20, 20, 1, 1, true]);
      assert.equal(value.nodes.length, 7, "only the synthetic z-index placeholder is removed; every real node remains");
      const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(value)));
      assert.equal(applyAllAutoLayouts(reopened.nodes), false);
      const transfer = treeNodes(createFigmaTransfer(reopened));
      assert.equal(transfer.find((node) => node.id === status.id).layoutPositioning, "absolute");
      assert.equal(transfer.find((node) => node.id === navigation.id).layoutSizingHorizontal, "fill");
      assert.deepEqual(new Set(transfer.map((node) => node.id)), new Set(value.nodes.map((node) => node.id)));
    }
  }
  assert.equal(report.passed, true);
  assert.deepEqual(report.blockedRequests, []); assert.deepEqual(report.browserErrors, []);
  const browser = await chromium.launch({ args: ["--disable-gpu"] }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 400, height: 240 }, deviceScaleFactor: 1 });
  const value = normalizeDesignDocument(JSON.parse(await readFile(join(output, "empty-0/narrow.codesign.json"))));
  const navigation = byId(value, "navigation"), statusId = byId(value, "status").id;
  navigation.height = 80; applyAllAutoLayouts(value.nodes);
  assert.equal(byId(value, "header").height, 110);
  assert.equal(byId(value, "after").y, 142);
  assert.equal(byId(value, "status").id, statusId);
  await page.setContent(`<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;background:white}${css}#navigation{height:80px}</style>${html()}`);
  const source = await page.screenshot();
  await page.setContent(exportDesignFrontend(normalizeDesignDocument(JSON.parse(serializeDesignDocument(value)))));
  assert.equal(comparePixels(source, await page.screenshot()).metrics.changedPixels, 0, "real flow edit survives save/reopen and frontend export");
});

const negativeCases = [
  { id: "solid", css: "background:red" },
  { id: "stroke", css: "border:1px solid red" },
  { id: "outline", css: "outline:1px solid red" },
  { id: "gradient", css: "background:linear-gradient(red,blue)" },
  { id: "shadow", css: "box-shadow:2px 2px 2px red" },
  { id: "filter", css: "filter:blur(1px)" },
  { id: "backdrop", css: "backdrop-filter:blur(1px)" },
  { id: "blend", css: "mix-blend-mode:multiply" },
  { id: "image", css: "background-image:url(data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%221%22%20height=%221%22%3E%3C/svg%3E)" },
  { id: "hidden-descendant", content: '<i style="display:none">hidden content</i>' },
  { id: "zero-font-content", content: "Still authored content", css: "font-size:0" },
  { id: "generated", pseudo: '#status::before{content:" "}' },
  { id: "preformatted", content: "\n\n", css: "white-space:pre" },
  { id: "scrollbar", css: "overflow:scroll" },
  { id: "native-appearance", css: "appearance:button" },
  { id: "resize-handle", css: "resize:both" },
];

test("paint, effects, generated and hidden content keep the absolute overlay paint-order boundary", async (t) => {
  const browser = await chromium.launch({ args: ["--disable-gpu"] }); t.after(() => browser.close());
  const page = await browser.newPage();
  const blocked = [], errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.href === "https://empty-overlay.test/") return route.fulfill({ contentType: "text/html", body: "<!doctype html>" });
    if (url.origin === "https://empty-overlay.test" && url.pathname.startsWith("/app/") && url.pathname.endsWith(".mjs")) {
      const path = resolve(appRoot, url.pathname.slice(5));
      if (path.startsWith(`${appRoot}/`)) return route.fulfill({ contentType: "text/javascript", body: await readFile(path) });
    }
    blocked.push(url.href); return route.abort();
  });
  await page.goto("https://empty-overlay.test/");
  for (const variant of [{ id: "unpainted" }, ...negativeCases]) {
    await page.setContent(`<!doctype html><style>*{box-sizing:border-box}body{margin:0}${css}#status{${variant.css ?? ""}}${variant.pseudo ?? ""}</style>${html(variant.content ?? "")}`);
    const observed = await page.evaluate(async () => {
      const { convertToDesignDSL } = await import("/app/vendor/html2figma-browser.mjs");
      const { planHtmlBlockFlow } = await import("/app/html-block-flow.mjs");
      const source = convertToDesignDSL(document.querySelector("#header"));
      const before = JSON.stringify(source), result = planHtmlBlockFlow(source, "root-relative");
      const status = source.children.find((node) => node.semantic?.attributes?.id === "status");
      const evidence = [];
      if (!result.unsupported) {
        for (const change of ["missing-dom-proof", "string-dom-proof", "missing-raw", "missing-outline-proof", "fixed", "intrinsic-image"]) {
          const copy = JSON.parse(before), candidate = copy.children.find((node) => node.semantic?.attributes?.id === "status");
          if (change === "missing-dom-proof") delete candidate.cssEmptyBlock;
          if (change === "string-dom-proof") candidate.cssEmptyBlock = "true";
          if (change === "missing-raw") delete candidate.rawStyles;
          if (change === "missing-outline-proof") delete candidate.rawStyles["outline-style"];
          if (change === "fixed") { candidate.positioning.mode = "fixed"; candidate.cssLayout.position = "fixed"; }
          if (change === "intrinsic-image") candidate.tag = "img";
          evidence.push({ change, unsupported: planHtmlBlockFlow(copy, "root-relative")?.unsupported ?? null });
        }
      }
      return { unsupported: result?.unsupported ?? null, unchanged: before === JSON.stringify(source),
        evidence,
        items: result?.items?.map((item) => item.source.semantic?.attributes?.id), statusEmpty: status?.cssEmptyBlock === true,
        entries: result?.entries?.map((entry) => ({ id: entry.source.semantic?.attributes?.id, position: entry.source.positioning?.mode })) };
    });
    assert.equal(observed.unchanged, true, variant.id);
    if (variant.id === "unpainted") {
      assert.equal(observed.unsupported, null);
      assert.deepEqual(observed.items, ["languages", "navigation"]);
      assert.equal(observed.entries.find((entry) => entry.id === "status").position, "absolute");
      for (const entry of observed.evidence) assert.match(entry.unsupported, /绝对覆盖/, entry.change);
    } else assert.match(observed.unsupported, /绝对覆盖/, `${variant.id}: ${JSON.stringify(observed)}`);
  }
  assert.deepEqual(blocked, []); assert.deepEqual(errors, []);
});
