import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PNG } from "pngjs";
import { chromium } from "playwright";
import { runProductionFidelity, comparePixels } from "../../../scripts/design-studio-production-fidelity.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { planHtmlImageBorderBox } from "../../../apps/design-studio/app/html-image-border-box.mjs";

const bitmap = new PNG({ width: 30, height: 30 });
for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) {
  const i = 4 * (30 * y + x);
  bitmap.data.set([x < 15 ? 240 : 20, y < 15 ? 40 : 210, 80, x < 15 && y < 15 ? 100 : 255], i);
}
const bytes = PNG.sync.write(bitmap);
const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;

test("ordinary bordered IMG becomes its original semantic Frame and one factory-owned Fill image", async (t) => {
  const output = process.env.IMAGE_BORDER_EVIDENCE ?? await mkdtemp(join(tmpdir(), "image-border-box-"));
  if (!process.env.IMAGE_BORDER_EVIDENCE) t.after(() => rm(output, { recursive: true, force: true }));
  const html = `<main id="fixture"><img id="photo" width="32" height="32" src="${dataUrl}"></main>`;
  const css = '#fixture{display:flex;align-items:start;width:100%;height:240px;padding:16px;background:#cbd5e1}#photo{display:block;border:1px solid #fff;object-position:50% 50%}';
  const result = await runProductionFidelity({ output, cpuOnly: true, resizeMode: "viewport-only", cases: [
    { id: "square", html, css },
    { id: "natural", html: html.replace('width="32" height="32"', ''), css },
    { id: "rounded", html, css: css + '#photo{border-radius:8px}' },
    { id: "percent-circle", html, css: css + '#photo{border-radius:50%}' },
    { id: "opacity", html, css: css + '#photo{opacity:.5}' },
    { id: "cover", html, css: css + '#photo{width:62px;object-fit:cover}' },
    { id: "contain", html, css: css + '#photo{width:62px;object-fit:contain}' },
  ], recordOnly: true });
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  t.after(() => browser.close());
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const observed of result.cases) {
    // Rounded SVG border/bitmap clips retain a measured antialiasing negative;
    // the strict receipt never relabels it a pixel pass.
    if (!["rounded", "percent-circle"].includes(observed.id))
      assert(observed.comparisons.every((item) => item.changedPixels === 0), JSON.stringify(observed));
    else assert.equal(observed.passed, false, "known rounded SVG residual stays a strict failed fidelity result");
    assert(observed.flowAudits.every((audit) => audit.passed));
    for (const [stage, width] of [["imported", 640], ["narrow", 400]]) {
      const document = normalizeDesignDocument(JSON.parse(await readFile(join(output, observed.id, `${stage}.codesign.json`), "utf8")));
      const frame = document.nodes.find((node) => node.name === "img#photo"), image = document.nodes.find((node) => node.parentId === frame?.id);
      assert(frame); assert(image);
      assert.equal(frame.type, "frame"); assert.equal(frame.layout, "vertical");
      assert.equal(frame.strokeAlign, "inside"); assert.equal(frame.padding, 1);
      assert.equal(image.type, "image"); assert.equal(image.id, `${frame.id}-image-content`);
      assert.equal(image.width, frame.width - 2); assert.equal(image.height, 30);
      assert.equal(image.x, frame.x + 1); assert.equal(image.y, frame.y + 1);
      assert.equal(image.opacity, 1); assert.equal(image.strokeWidth, 0);
      assert.equal(image.layoutSizingHorizontal, "fill"); assert.equal(image.layoutSizingVertical, "fill");
      assert(document.nodes.every((node) => node.layoutPositioning !== "absolute"));
      assert.equal(document.resources.length, 1);
      const portable = JSON.parse(await readFile(join(output, observed.id, "complete.portable.json"), "utf8"));
      assert.equal(portable.resources[0].base64, bytes.toString("base64"));
      const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(document)));
      assert.equal(applyAllAutoLayouts(reopened.nodes), false);
      const resources = new Map([[image.imageRef, dataUrl]]);
      await page.setViewportSize({ width, height: 240 });
      await page.setContent(exportDesignFrontend(reopened, { resourceDataUrls: resources }));
      await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
      const reference = await readFile(join(output, observed.id, `${stage}-source.png`));
      assert.equal(comparePixels(reference, await page.screenshot()).metrics.changedPixels, 0, `${observed.id}/${stage}/frontend`);
      if (observed.id === "cover" && stage === "imported") {
        const sourcePage = await browser.newPage({ viewport: { width, height: 240 } });
        try {
          await sourcePage.setContent(await readFile(join(output, observed.id, "source.html"), "utf8"));
          await sourcePage.evaluate(async () => { await document.images[0].decode(); document.querySelector("#photo").style.cssText = "width:94px;height:48px"; });
          await page.locator(`[data-codeshell-id="${frame.id}"]`).evaluate((element) => {
            element.style.width = "94px"; element.style.height = "48px";
          });
          assert.equal(comparePixels(await sourcePage.screenshot(), await page.screenshot()).metrics.changedPixels, 0, "live frontend border-box edits preserve inset object-fit");
          const editedFrame = reopened.nodes.find((node) => node.id === frame.id);
          editedFrame.width = 94; editedFrame.height = 48; applyAllAutoLayouts(reopened.nodes);
          const editedImage = reopened.nodes.find((node) => node.id === image.id);
          assert.deepEqual([editedImage.width, editedImage.height], [92, 46]);
          assert.equal(normalizeDesignDocument(JSON.parse(serializeDesignDocument(reopened))).nodes.find((node) => node.id === image.id).imageRef, image.imageRef);
        } finally { await sourcePage.close(); }
      }
      if (observed.id === "percent-circle") {
        assert.equal(frame.cornerRadius, 16); assert.equal(image.cornerRadius, 15);
        assert(observed.warnings.some((warning) => warning.code === "image-radius-captured-size"));
      }
    }
  }
  assert.deepEqual(result.blockedRequests, []); assert.deepEqual(result.browserErrors, []);
});

test("image border planner refuses unsupported joins instead of broadening Image border grammar", () => {
  const facts = { complete: "true", ancestorGeometry: "ordinary", "object-position": "50% 50%", transform: "none", rotate: "none", scale: "none", translate: "none", zoom: "1", filter: "none",
    "backdrop-filter": "none", "mix-blend-mode": "normal", "box-shadow": "none", "outline-style": "none", "clip-path": "none",
    "mask-image": "none", "background-image": "none", "background-color": "rgba(0, 0, 0, 0)", "border-image-source": "none", "object-fit": "fill" };
  const border = {}, css = { position: "static", width: "32px", height: "32px", "min-width": "auto", "min-height": "auto", "max-width": "none", "max-height": "none", "aspect-ratio": "auto" };
  for (const side of ["top", "right", "bottom", "left"]) {
    Object.assign(facts, { [`padding-${side}`]: "0px", [`border-${side}-style`]: "solid", [`border-${side}-width`]: "1px", [`border-${side}-color`]: "rgb(255, 255, 255)" });
    border[side] = { width: 1 };
  }
  const source = { nodeType: "image", tag: "img", semantic: { semanticId: "actual-img" }, cssImageBox: facts, cssLayout: css, border, cssBorderRadii: Array(4).fill("50%") };
  const node = { width: 32, height: 32, objectFit: "fill", strokeAlign: "inside", strokeSides: Array.from({ length: 4 }, () => ({ width: 1, color: "#ffffff", opacity: 1 })) };
  assert.deepEqual(planHtmlImageBorderBox(source, node), { width: 1, radius: 16, innerRadius: 15, percentCircle: true });
  for (const change of [
    { cssImageBox: undefined }, { tag: "canvas" }, { semantic: undefined }, { transform: { rotation: 1 } },
    { cssLayout: { ...css, width: "50%" } }, { cssLayout: { ...css, "max-width": "32px" } },
    { cssLayout: { ...css, "aspect-ratio": "1 / 1" } }, { flexItem: { grow: 1 } },
    { cssImageBox: { ...facts, "padding-left": "1px" } }, { cssImageBox: { ...facts, "object-position": "left top" } },
    { cssImageBox: { ...facts, "border-left-width": "2px" } }, { cssImageBox: { ...facts, "filter": "blur(1px)" } },
    { cssImageBox: { ...facts, scale: "2" } }, { cssImageBox: { ...facts, rotate: "1deg" } },
    { cssImageBox: { ...facts, translate: "1px" } }, { cssImageBox: { ...facts, ancestorGeometry: "unsupported" } },
    { cssImageBox: { ...facts, "background-color": "rgb(0, 0, 0)" } }, { cssBorderRadii: Array(4) },
    { cssBorderRadii: ["50%", "0px", "50%", "50%"] }, { cssBorderRadii: Array(4).fill("25%") },
    { cssBorderRadii: ["8px", "0px", "8px", "8px"] }, { cssBorderRadii: Array(4).fill("8px 4px") },
  ]) assert.throws(() => planHtmlImageBorderBox({ ...source, ...change }, node), /HTML_IMAGE_BORDER_UNSUPPORTED/u);
  assert.throws(() => planHtmlImageBorderBox(source, { ...node, width: 33 }), /固定方形/u);
  assert.throws(() => planHtmlImageBorderBox(source, node, { transformedAncestor: true }), /变换/u);
});

test('live IMG capture refuses individual transforms, painted backgrounds, and unsupported border joins atomically', async (t) => {
  const browser = await chromium.launch({ args: ['--disable-gpu'] }); t.after(() => browser.close());
  const page = await browser.newPage();
  const { resolve } = await import('node:path');
  const appRoot = resolve('apps/design-studio/app');
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.href === 'https://image-box.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' });
    const file = resolve(appRoot, '.' + url.pathname);
    if (file.startsWith(appRoot + '/') && file.endsWith('.mjs')) return route.fulfill({ contentType: 'text/javascript', body: await readFile(file) });
    return route.abort();
  });
  await page.goto('https://image-box.test/');
  const cases = ['#photo{scale:2}', '#photo{rotate:1deg}', '#photo{translate:1px}', 'main{scale:2}', 'main{zoom:2}',
    '#photo{background:#123456}', '#photo{padding:1px}', '#photo{border-left-width:2px}', '#photo{border-style:dashed}',
    '#photo{border-radius:25%}', '#photo{border-radius:8px 0}', '#photo{object-position:left top}', '#photo{border-radius:50%;width:50%}'];
  for (const css of cases) {
    const observed = await page.evaluate(async ({ css, dataUrl }) => {
      const { captureWorkspaceHtmlResult } = await import('/html-import.mjs');
      try {
        await captureWorkspaceHtmlResult({ html: `<style>*{box-sizing:border-box}html,body{margin:0}main{display:flex;width:100%;height:120px}img{border:1px solid white}${css}</style><main id="fixture"><img id="photo" width="32" height="32" src="${dataUrl}"></main>`,
          sourcePath: 'source.html', rootSelector: '#fixture', readText: async () => '', viewportWidth: 640, viewportHeight: 240 });
        return { admitted: true };
      } catch (error) { return { admitted: false, message: error.message }; }
    }, { css, dataUrl });
    assert.equal(observed.admitted, false, css);
    assert.match(observed.message, /HTML_IMAGE_BORDER_UNSUPPORTED/u, css);
  }
});
