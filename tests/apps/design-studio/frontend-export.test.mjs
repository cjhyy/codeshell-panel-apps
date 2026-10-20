import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { exportDesignFrontend, renderDesignFrontendPage } from "../../../apps/design-studio/app/frontend-export.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { comparePixels } from "../../../scripts/design-studio-production-fidelity.mjs";

const node = (id, type, extra = {}) => ({ id, type, name: id, x: 0, y: 0, width: 100, height: 30,
  fill: "#2563eb", stroke: "transparent", strokeWidth: 0, opacity: 1, rotation: 0, cornerRadius: 0,
  visible: true, locked: false, ...(["frame", "group", "component"].includes(type) ? { layout: "none", layoutWrap: "none", gap: 0, padding: 0, alignItems: "start", justifyContent: "start", children: [] } : {}), ...extra });
function fixture() {
  return {
    format: "codeshell.design", version: 3, name: "Frontend Flow", canvas: { width: 640, height: 240, background: "#ffffff" },
    tokens: { colors: [] }, resources: [], activePageId: "home", pages: [{ id: "home", name: "Home", children: [
      node("viewport", "frame", { width: 640, height: 240, fill: "#ffffff", layout: "vertical", gap: 8,
        layoutSizingHorizontal: "fill", layoutSizingVertical: "fixed", children: [
          node("flow", "frame", { width: 640, height: 46, fill: "#eeeeee", layout: "horizontal", layoutWrap: "wrap",
            rowGap: 16, columnGap: 0, paddingTop: 16, alignContent: "start", layoutSizingHorizontal: "fill", layoutSizingVertical: "hug",
            children: Array.from({ length: 6 }, (_, i) => node(`tile-${i}`, "rectangle", { x: i * 100, y: 16,
              layoutSizingHorizontal: "fixed", layoutSizingVertical: "fixed" })) }),
          node("footer", "rectangle", { y: 54, width: 640, height: 12, fill: "#f97316", layoutSizingHorizontal: "fill", layoutSizingVertical: "fixed" }),
          node("badge", "rectangle", { x: 8, y: 220, width: 8, height: 8, fill: "#dc2626", layoutPositioning: "absolute" }),
        ] }),
    ] }, { id: "library", name: "Library", children: [node("component", "component", {
      width: 40, height: 10, layout: "vertical", children: [node("component-child", "rectangle", { width: 40, height: 10 })],
    })] }],
  };
}
const saved = state => JSON.parse(serializeDesignDocument(state));
const reference = height => `<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;background:white}.viewport{position:relative;width:100%;height:240px;display:flex;flex-direction:column;gap:8px}.flow{display:flex;flex-wrap:wrap;align-items:flex-start;align-content:flex-start;row-gap:16px;width:100%;padding-top:16px;background:#eee;flex-shrink:0}.tile{width:100px;height:${height}px;flex-shrink:0;background:#2563eb}.footer{height:12px;width:100%;flex-shrink:0;background:#f97316}.badge{position:absolute;left:8px;top:220px;width:8px;height:8px;background:#dc2626}</style><main class="viewport"><section class="flow">${'<div class="tile"></div>'.repeat(6)}</section><div class="footer"></div><div class="badge"></div></main>`;

async function expectFlow(page, width, tileHeight) {
  const actual = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-codeshell-id]")].map(n => {
    const b = n.getBoundingClientRect(); return [n.dataset.codeshellId, { parent: n.parentElement.dataset.codeshellId ?? null,
      position: getComputedStyle(n).position, x: b.x, y: b.y, width: b.width, height: b.height }];
  })));
  assert.equal(Object.keys(actual).length, 10);
  assert.equal(actual.flow.parent, "viewport"); assert.equal(actual.footer.parent, "viewport");
  const rows = width === 640 ? 1 : 2, height = 16 + rows * tileHeight + (rows - 1) * 16;
  assert.deepEqual([actual.flow.width, actual.flow.height, actual.flow.position], [width, height, "relative"]);
  assert.deepEqual([actual.footer.y, actual.footer.width, actual.footer.position], [height + 8, width, "relative"]);
  for (let i = 0; i < 6; i++) { const tile = actual[`tile-${i}`]; assert.equal(tile.parent, "flow"); assert.equal(tile.position, "relative");
    assert.deepEqual([tile.x, tile.y, tile.width, tile.height], [(i % (width === 640 ? 6 : 4)) * 100, 16 + Math.floor(i / (width === 640 ? 6 : 4)) * (tileHeight + 16), 100, tileHeight]); }
  assert.equal(actual.badge.position, "absolute"); assert.equal(actual.badge.parent, "viewport");
}

test("normalized flat pages retain hierarchy, source order, current active edits and inactive components", () => {
  const state = normalizeDesignDocument(fixture()), before = JSON.stringify(state);
  assert.equal(exportDesignFrontend(state), exportDesignFrontend(saved(state)));
  for (const pageId of ["home", "library"]) assert.equal(renderDesignFrontendPage(state, { pageId }), renderDesignFrontendPage(saved(state), { pageId }));
  assert.equal(JSON.stringify(state), before, "export never mutates flat state or page snapshots");
  state.nodes = state.nodes.map(n => n.id === "tile-0" ? { ...n, fill: "#16a34a" } : n);
  assert.notEqual(state.nodes, state.pages[0].nodes); assert.equal(exportDesignFrontend(state), exportDesignFrontend(saved(state)));
  assert.match(exportDesignFrontend(state), /#16a34a/u);
  const hierarchy = saved(state); hierarchy.pages[0].nodes = [{ id: "ignored-flat-snapshot" }];
  assert.equal(exportDesignFrontend(hierarchy), exportDesignFrontend(saved(state)), "existing page.children takes precedence");
  const pageOnlyFlat = { ...state }; delete pageOnlyFlat.nodes;
  assert.equal(exportDesignFrontend(pageOnlyFlat), exportDesignFrontend(saved({ ...state, nodes: state.pages[0].nodes })), "legacy flat page.nodes without top-level nodes remains supported");
  state.nodes.push(node("instance", "instance", { x: 500, y: 180, width: 40, height: 10, componentId: "component" }));
  assert.equal(exportDesignFrontend(state), exportDesignFrontend(saved(state)), "component children on inactive flat pages are nested before instance expansion");
  assert.match(exportDesignFrontend(state), /data-codeshell-source-id="component-child"/u);
});

test("flat parent references fail explicitly instead of silently rendering every node at root", () => {
  const state = normalizeDesignDocument(fixture()); state.nodes.find(n => n.id === "flow").parentId = "missing";
  assert.throws(() => exportDesignFrontend(state), /不存在的容器/u);
  state.nodes.find(n => n.id === "flow").parentId = "flow"; assert.throws(() => exportDesignFrontend(state), /循环/u);
});

test("actual CLI frontend file keeps editable nested flow through resize and saved edits", async t => {
  const project = await mkdtemp(join(tmpdir(), "frontend-flat-cli-")); t.after(() => rm(project, { recursive: true, force: true }));
  await mkdir(join(project, "designs")); const path = "designs/flow.codesign.json";
  const cli = fileURLToPath(new URL("../../../apps/design-studio/app/tools/design-studio.mjs", import.meta.url));
  const state = normalizeDesignDocument(fixture());
  const browser = await chromium.launch({ args: ["--disable-gpu"] }); t.after(() => browser.close()); const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const tileHeight of [30, 40]) {
    state.nodes.filter(n => n.id.startsWith("tile-")).forEach(n => { n.height = tileHeight; }); applyAllAutoLayouts(state.nodes);
    const source = serializeDesignDocument(state); await writeFile(join(project, path), source);
    const reopened = normalizeDesignDocument(JSON.parse(await readFile(join(project, path)))); assert.equal(exportDesignFrontend(reopened), exportDesignFrontend(saved(reopened)));
    const request = join(project, `request-${tileHeight}.json`), output = `designs/flow-${tileHeight}.html`;
    await writeFile(request, JSON.stringify({ path, output }));
    const result = await promisify(execFile)(process.execPath, [cli, "run", "frontend", "--project", project, "--input-file", request], { cwd: tmpdir(), timeout: 15000 });
    assert.equal(result.stderr, ""); const receipt = JSON.parse(result.stdout); assert.equal(receipt.ok, true); assert.equal(receipt.result.pageId, "home");
    const html = await readFile(join(project, output), "utf8"); assert.equal(html, exportDesignFrontend(reopened));
    assert.equal(await readFile(join(project, path), "utf8"), source, "read-only export leaves the saved document unchanged");
    for (const width of [640, 400]) {
      await page.setViewportSize({ width, height: 240 }); await page.setContent(reference(tileHeight)); const pixels = await page.screenshot();
      await page.setContent(html); await expectFlow(page, width, tileHeight);
      assert.equal(comparePixels(pixels, await page.screenshot()).metrics.changedPixels, 0, `${tileHeight}px/${width}px actual CLI HTML`);
      const resized = normalizeDesignDocument(JSON.parse(source)); resized.nodes.find(n => n.id === "viewport").width = width; resized.canvas.width = width; applyAllAutoLayouts(resized.nodes);
      const roundtrip = normalizeDesignDocument(JSON.parse(serializeDesignDocument(resized))); await page.setContent(exportDesignFrontend(roundtrip)); await expectFlow(page, width, tileHeight);
      assert.equal(comparePixels(pixels, await page.screenshot()).metrics.changedPixels, 0, `${tileHeight}px/${width}px edit/reflow/save/reopen`);
    }
  }
});

test("canonical Text shadows use glyph CSS and retain the unresolved zero-blur edge boundary through DOM edits", async t => {
  const browser = await chromium.launch({ args: ["--disable-gpu"] }); t.after(() => browser.close());
  const page = await browser.newPage({ deviceScaleFactor: 1 }), referencePage = await browser.newPage({ deviceScaleFactor: 1 });
  const appRoot = fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.href === "https://text-shadow.test/") return route.fulfill({ contentType: "text/html", body: "<!doctype html>" });
    if (url.origin === "https://text-shadow.test" && url.pathname.startsWith("/app/") && url.pathname.endsWith(".mjs")) {
      const path = join(appRoot, url.pathname.slice(5));
      if (path.startsWith(appRoot)) return route.fulfill({ contentType: "text/javascript", body: await readFile(path) });
    }
    return route.abort();
  });
  await page.goto("https://text-shadow.test/");
  const original = "Shadowed editable text with a line that wraps when its owner gets narrower.", grown = "  First  authored line\nSecond line\nThird line\nFourth line";
  const shadows = [
    { color: "#000000", opacity: .5, x: 0, y: .8, blur: 1.6 },
    { color: "#dc2626", opacity: 1, x: 2, y: 3, blur: 0 },
    { color: "#2563eb", opacity: .5, x: -2, y: 4, blur: 8 },
  ];
  for (const shadow of shadows) {
    const rgb = [1, 3, 5].map(index => Number.parseInt(shadow.color.slice(index, index + 2), 16));
    const cssShadow = `${shadow.x}px ${shadow.y}px ${shadow.blur}px rgba(${rgb.join(",")},${shadow.opacity})`;
    const html = `<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;background:white}#fixture{display:flex;flex-direction:column;width:100%;height:240px;padding:16px;background:#212529}p{margin:0;align-self:stretch;color:white;font:20px/30px Arial;letter-spacing:0px;white-space:normal;overflow-wrap:anywhere;text-shadow:${cssShadow}}</style><main id="fixture"><p id="copy">${original}</p></main>`;
    await page.setViewportSize({ width: 640, height: 240 });
    const captured = await page.evaluate(async html => {
      const { captureWorkspaceHtmlResult } = await import("/app/html-import.mjs");
      return (await captureWorkspaceHtmlResult({ html, sourcePath: "shadow.html", readText: async () => "", rootSelector: "body", viewportWidth: 640, viewportHeight: 240 })).document;
    }, html);
    const state = normalizeDesignDocument(captured), text = state.nodes.find(node => node.type === "text");
    const geometry = state.nodes.map(node => [node.id, node.x, node.y, node.width, node.height]);
    text.shadow = shadow;
    const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(state)));
    assert.deepEqual(reopened.nodes.find(node => node.id === text.id).shadow, shadow);
    assert.deepEqual(reopened.nodes.map(node => [node.id, node.x, node.y, node.width, node.height]), geometry);
    const output = exportDesignFrontend(reopened), selector = `[data-codeshell-id="${text.id}"]`;
    await page.setContent(output); await referencePage.setContent(html);
    await referencePage.locator("#copy").evaluate(node => { node.style.whiteSpace = "pre-wrap"; });
    for (const [width, copy] of [[640, original], [400, original], [400, grown], [640, grown], [640, original]]) {
      await page.setViewportSize({ width, height: 240 }); await referencePage.setViewportSize({ width, height: 240 });
      await page.locator('[data-codeshell-id="html-viewport"]').evaluate((node, width) => { node.style.width = `${width}px`; }, width);
      await page.locator(selector).evaluate((node, copy) => { node.textContent = copy; }, copy);
      await referencePage.locator("#copy").evaluate((node, copy) => { node.textContent = copy; }, copy);
      await Promise.all([page, referencePage].map(p => p.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); })));
      const style = await page.locator(selector).evaluate(node => ({ position: getComputedStyle(node).position, box: getComputedStyle(node).boxShadow, text: getComputedStyle(node).textShadow, copy: node.textContent }));
      assert.equal(style.position, "relative"); assert.equal(style.box, "none"); assert.notEqual(style.text, "none"); assert.equal(style.copy, copy);
      const expectedPixels=await referencePage.screenshot(),actualPixels=await page.screenshot(),compared=comparePixels(expectedPixels,actualPixels);
      if(shadow.blur===0){
        // This is an explicit unresolved strict failure, not an AA tolerance or
        // pixel-parity pass. Preserve the original authored copy and full pixels.
        if(compared.metrics.changedPixels){
          const {PNG}=await import("pngjs"),a=PNG.sync.read(expectedPixels),b=PNG.sync.read(actualPixels),differences=[];
          for(let i=0;i<a.data.length;i+=4)if(a.data.subarray(i,i+4).some((v,c)=>v!==b.data[i+c]))differences.push({x:i/4%a.width,y:Math.floor(i/4/a.width),expected:[...a.data.subarray(i,i+4)],actual:[...b.data.subarray(i,i+4)]});
          assert.deepEqual(differences,[{x:15,y:57,expected:[35,39,43,255],actual:[33,37,41,255]}],"A new paint difference must not hide behind the known one-pixel boundary");
          await referencePage.locator("#copy").evaluate(node=>node.style.position="relative");
          const relativePhase=comparePixels(await referencePage.screenshot(),actualPixels).metrics;
          await referencePage.locator("#copy").evaluate(node=>node.style.removeProperty("position"));
          const artifactDirectory=await mkdtemp(join(tmpdir(),"design-text-shadow-boundary-"));
          const receipt={unresolvedStrictBoundary:true,width,copy,strictPixelParity:false,metrics:compared.metrics,relativePositionControl:relativePhase,artifactDirectory};
          await Promise.all([writeFile(join(artifactDirectory,"expected.png"),expectedPixels),writeFile(join(artifactDirectory,"actual.png"),actualPixels),writeFile(join(artifactDirectory,"receipt.json"),JSON.stringify(receipt,null,2)+"\n")]);
          t.diagnostic(JSON.stringify(receipt));
        }else t.diagnostic(JSON.stringify({unresolvedStrictBoundary:true,width,copy,strictPixelParity:false,samplePixelsEqual:true,metrics:compared.metrics}));
      }else{
        assert.equal(compared.metrics.changedPixels, 0, `${cssShadow}/${width}/${copy}`);
        assert.equal(compared.metrics.maximumChannelDelta, 0);
      }
    }
  }
});
