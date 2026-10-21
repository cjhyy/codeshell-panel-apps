import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { comparePixels } from "../../../scripts/design-studio-production-fidelity.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/design-studio/app");
const css = {
  "base.css": "*{box-sizing:border-box}html,body{margin:0;background:white}#fixture{display:flex;flex-direction:column;width:100%;height:240px;padding:20px;gap:12px;background:#e2e8f0}#screen,#print{height:40px}",
  "screen.css": "#screen{background:#2563eb}#print{display:none}",
  "print.css": "#screen{display:none!important}#print{display:block;background:#dc2626;height:50px}",
  "small.css": "#screen{height:70px;background:#16a34a}",
  "wide-or-print.css": "#fixture{padding:24px}",
};
const html = `<!doctype html><link rel="stylesheet" href="base.css"><link rel="stylesheet" href="screen.css" media="screen"><link rel="stylesheet" href="print.css" media="print"><link rel="stylesheet" href="small.css" media=" screen and (max-width: 500px) "><link rel="stylesheet" href="wide-or-print.css" media="screen and (min-width: 600px), print"><style media="print">#print{height:60px}</style><main id="fixture"><div id="screen"></div><div id="print"></div></main>`;

for (const media of ["screen", "print"]) {
  test(`linked stylesheets retain ${media} and viewport media conditions in production capture`, async (t) => {
    const browser = await chromium.launch({ args: ["--disable-gpu"] });
    t.after(() => browser.close());
    const context = await browser.newContext({ deviceScaleFactor: 1 });
    const blocked = [], errors = [];
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.href === "https://media.test/")
        return route.fulfill({ contentType: "text/html", body: "<!doctype html>" });
      if (url.href === "https://media.test/reference.html")
        return route.fulfill({ contentType: "text/html", body: html });
      if (url.origin === "https://media.test" && css[url.pathname.slice(1)])
        return route.fulfill({ contentType: "text/css", body: css[url.pathname.slice(1)] });
      if (url.origin === "https://media.test" && url.pathname.startsWith("/app/") && url.pathname.endsWith(".mjs")) {
        const path = resolve(appRoot, url.pathname.slice(5));
        if (path.startsWith(`${appRoot}/`))
          return route.fulfill({ contentType: "text/javascript", body: await readFile(path) });
      }
      blocked.push(url.href);
      return route.abort();
    });
    const capturePage = await context.newPage(), referencePage = await context.newPage(), svgPage = await context.newPage();
    for (const page of [capturePage, referencePage, svgPage]) {
      page.on("pageerror", (error) => errors.push(error.message));
      await page.emulateMedia({ media });
    }
    await capturePage.goto("https://media.test/");
    for (const width of [640, 400]) {
      await referencePage.setViewportSize({ width, height: 240 });
      await referencePage.goto("https://media.test/reference.html");
      const expected = await referencePage.evaluate(() => {
        const id = getComputedStyle(document.querySelector("#screen")).display === "none" ? "print" : "screen";
        const box = document.getElementById(id).getBoundingClientRect();
        return { id, geometry: [box.x, box.y, box.width, box.height] };
      });
      const captured = await capturePage.evaluate(async ({ html, css, width }) => {
        const { captureWorkspaceHtmlResult } = await import("/app/html-import.mjs");
        const { normalizeDesignDocument, serializeDesignDocument, exportDesignSvg } = await import("/app/document.mjs");
        const { applyAllAutoLayouts } = await import("/app/layout.mjs");
        const reads = [];
        const result = await captureWorkspaceHtmlResult({
          html, sourcePath: "source.html", readText: async (path) => { reads.push(path); return css[path]; },
          rootSelector: "#fixture", viewportWidth: width, viewportHeight: 240,
        });
        const documentValue = normalizeDesignDocument(result.document);
        const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(documentValue)));
        applyAllAutoLayouts(reopened.nodes);
        const values = (document) => document.nodes.map((node) => [node.id, node.x, node.y, node.width, node.height]);
        return { document: result.document, reads, reopenedStable: JSON.stringify(values(documentValue)) === JSON.stringify(values(reopened)),
          svg: exportDesignSvg(documentValue), remainingFrames: document.querySelectorAll("iframe").length };
      }, { html, css, width });
      const visible = captured.document.pages[0].children.flatMap(function visit(node) {
        return [node, ...(node.children ?? []).flatMap(visit)];
      }).find((node) => {
        try { return JSON.parse(node.notes).attributes?.id === expected.id; } catch { return false; }
      });
      assert(visible, `${media} at ${width}: expected ${expected.id}`);
      assert.deepEqual([visible.x, visible.y, visible.width, visible.height], expected.geometry);
      assert.equal(visible.fill, media === "print" ? "#dc2626" : width < 500 ? "#16a34a" : "#2563eb");
      assert.equal(captured.reopenedStable, true);
      assert.equal(captured.remainingFrames, 0);
      assert.deepEqual(captured.reads, Object.keys(css), "inactive styles are retained with their conditions rather than skipped");
      await svgPage.setViewportSize({ width, height: 240 });
      await svgPage.setContent(`<!doctype html><style>html,body{margin:0;background:white}</style>${captured.svg}`);
      const comparison = comparePixels(await referencePage.screenshot(), await svgPage.screenshot());
      assert.equal(comparison.metrics.changedPixels, 0, `${media} ${width}: ${JSON.stringify(comparison.metrics)}`);
    }
    assert.deepEqual(blocked, []);
    assert.deepEqual(errors, []);
  });
}

test("standalone folder preview retains the same stylesheet media conditions", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "html-stylesheet-media-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "source.html"), html);
  for (const [path, source] of Object.entries(css)) await writeFile(join(directory, path), source);
  const ui = await readFile(resolve(appRoot, "html-to-figma-plugin/ui.html"));
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage(), blocked = [], errors = [];
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", (route) => {
    if (route.request().url() === "https://plugin-media.test/")
      return route.fulfill({ contentType: "text/html", body: ui });
    blocked.push(route.request().url());
    return route.abort();
  });
  await page.goto("https://plugin-media.test/");
  await page.locator("#folder").setInputFiles(directory);
  await page.locator("body[aria-busy=false]").waitFor();
  await page.locator("#selector").fill("#fixture");
  await page.locator("#height").fill("240");
  for (const media of ["screen", "print"]) {
    await page.emulateMedia({ media });
    for (const width of [640, 400]) {
      await page.locator("#width").fill(String(width));
      await page.locator("#preview").click();
      await page.locator("body[aria-busy=false]").waitFor();
      assert.match(await page.locator("#status").textContent(), /预览完成/u);
      const observed = await page.frameLocator("#preview-stage iframe").locator("body").evaluate((body) => {
        const doc = body.ownerDocument, id = getComputedStyle(doc.querySelector("#screen")).display === "none" ? "print" : "screen";
        const element = doc.getElementById(id), box = element.getBoundingClientRect();
        return { id, geometry: [box.x, box.y, box.width, box.height],
          media: [...doc.querySelectorAll("style")].slice(0, 5).map((style) => style.getAttribute("media")) };
      });
      const inset = media === "print" || width >= 600 ? 24 : 20;
      assert.equal(observed.id, media);
      assert.deepEqual(observed.geometry, [inset, inset, width - 2 * inset, media === "print" ? 60 : width < 500 ? 70 : 40]);
      assert.deepEqual(observed.media, [null, "screen", "print", " screen and (max-width: 500px) ", "screen and (min-width: 600px), print"]);
      assert.equal(await page.locator("#create").isDisabled(), false);
    }
  }
  assert.deepEqual(blocked, []);
  assert.deepEqual(errors, []);
});
