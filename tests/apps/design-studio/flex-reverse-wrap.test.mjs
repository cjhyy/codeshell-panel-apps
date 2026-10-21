import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { normalizeDesignDocument, serializeDesignDocument, exportDesignSvg } from "../../../apps/design-studio/app/document.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";
import { runProductionFidelity, comparePixels } from "../../../scripts/design-studio-production-fidelity.mjs";

// Includes the production runner's internal launch; no graphics service used.
const launch = chromium.launch.bind(chromium);
chromium.launch = (options = {}) => launch({ ...options, args: [...(options.args ?? []), "--disable-gpu"] });
const colors = ["#2563eb", "#f97316", "#16a34a", "#a855f7", "#e11d48"];
const dimensions = [[90, 21], [130, 43], [70, 35], [110, 29], [80, 47]];
const shape = (id, type, box, extra = {}) => ({ id, type, name: id, ...box, fill: "#ffffff", stroke: "transparent", strokeWidth: 0,
  rotation: 0, opacity: 1, cornerRadius: 0, visible: true, locked: false,
  ...(["frame", "component"].includes(type) ? { layout: "none", gap: 0, padding: 0, alignItems: "start", justifyContent: "start", children: [] } : {}), ...extra });
const cssAlignment = value => value === "center" ? "center" : `flex-${value}`;
function cssFixture({ axis, reverse, wrap, alignment = "start", hug = false, size }) {
  const horizontal = axis === "horizontal";
  const cross = hug ? "auto" : "240px";
  const frame = `display:flex;flex-direction:${horizontal ? 'row' : 'column'}${reverse ? '-reverse' : ''};flex-wrap:${wrap};width:${horizontal ? size + 'px' : cross};height:${horizontal ? cross : size + 'px'};padding:11px 19px 23px 7px;row-gap:14px;column-gap:10px;align-items:${cssAlignment(alignment)};align-content:flex-start;justify-content:${cssAlignment(alignment)};position:absolute;left:13px;top:17px;background:#eeeeee`;
  return `<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;background:white}#frame{${frame}}.item{flex:0 0 auto}#hidden{display:none}#absolute{position:absolute;left:3px;top:4px;width:9px;height:13px;background:#0f172a}</style><main id="frame">${dimensions.map(([main, cross], index) => `<div class="item" id="item-${index}" style="width:${horizontal ? main : cross}px;height:${horizontal ? cross : main}px;background:${colors[index]};${index === 1 ? 'align-self:flex-end' : ''}"></div>`).join('')}<div id="hidden"></div><div id="absolute"></div></main>`;
}
async function capture(page, html) {
  await page.setContent(html);
  return page.evaluate(() => Object.fromEntries([document.querySelector('#frame'), ...document.querySelectorAll('.item,#absolute')].map(node => {
    const { x, y, width, height } = node.getBoundingClientRect(); return [node.id, { x, y, width, height }];
  })));
}
function canonical(config, boxes) {
  const frame = shape("frame", "frame", boxes.frame, { fill: "#eeeeee", layout: config.axis, layoutReverse: config.reverse,
    layoutWrap: config.wrap, layoutSizingHorizontal: config.hug && config.axis === 'vertical' ? 'hug' : 'fixed',
    layoutSizingVertical: config.hug && config.axis === 'horizontal' ? 'hug' : 'fixed',
    paddingTop: 11, paddingRight: 19, paddingBottom: 23, paddingLeft: 7, rowGap: 14, columnGap: 10,
    alignItems: config.alignment ?? 'start', alignContent: 'start', justifyContent: config.alignment ?? 'start',
    children: dimensions.map((_, index) => shape(`item-${index}`, 'rectangle', boxes[`item-${index}`], { fill: colors[index],
      layoutSizingHorizontal: 'fixed', layoutSizingVertical: 'fixed', ...(index === 1 ? { layoutAlignSelf: 'end' } : {}) })),
  });
  frame.children.splice(2, 0, shape('hidden', 'rectangle', { x: 111, y: 112, width: 37, height: 39 }, { visible: false }));
  frame.children.push(shape('absolute', 'rectangle', boxes.absolute, { fill: '#0f172a', layoutPositioning: 'absolute' }));
  return normalizeDesignDocument({ format: 'codeshell.design', version: 3, name: 'Reverse wrapping', canvas: { width: 600, height: 600, background: '#ffffff' }, tokens: { colors: [] }, resources: [], activePageId: 'page', pages: [{ id: 'page', name: 'Page', children: [frame] }] });
}
function assertGeometry(value, expected, label) {
  for (const node of value.nodes.filter(n => n.visible !== false)) {
    assert(expected[node.id], label + '/' + node.id);
    for (const key of ['x', 'y', 'width', 'height']) assert(Math.abs(node[key] - expected[node.id][key]) <= .001, `${label}/${node.id}.${key}: ${node[key]} != ${expected[node.id][key]}`);
  }
}
const svgPage = value => `<style>html,body{margin:0}svg{display:block}</style>${exportDesignSvg(value)}`;

test('CSS line membership precedes reverse direction for both axes, alignments and wrap directions', async t => {
  const browser = await chromium.launch(); t.after(() => browser.close()); const page = await browser.newPage({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
  for (const axis of ['horizontal', 'vertical']) for (const reverse of [false, true]) for (const wrap of ['wrap', 'wrap-reverse']) for (const alignment of ['start', 'center', 'end']) {
    const config = { axis, reverse, wrap, alignment, size: 306 }, label = JSON.stringify(config);
    let expected = await capture(page, cssFixture(config)); const value = canonical(config, expected), order = value.nodes.map(n => n.id), hiddenBefore = { ...value.nodes.find(n => n.id === 'hidden') };
    for (const size of [306, 246, 306]) {
      expected = await capture(page, cssFixture({ ...config, size })); const source = await page.screenshot();
      value.nodes[0][axis === 'horizontal' ? 'width' : 'height'] = size;
      applyAllAutoLayouts(value.nodes); assertGeometry(value, expected, label + '/' + size);
      assert.deepEqual(value.nodes.map(n => n.id), order, 'semantic layer order never follows visual reversal');
      assert.deepEqual(value.nodes.find(n => n.id === 'hidden'), hiddenBefore, 'hidden child never joins line packing');
      const saved = serializeDesignDocument(value), reopened = normalizeDesignDocument(JSON.parse(saved));
      assert.equal(applyAllAutoLayouts(reopened.nodes), false, label + ' save/reopen is already settled');
      assert.equal(serializeDesignDocument(reopened), saved);
      await page.setContent(svgPage(reopened)); assert.equal(comparePixels(source, await page.screenshot()).metrics.changedPixels, 0, label + '/' + size + '/SVG');
      await page.setContent(exportDesignFrontend(JSON.parse(saved))); assert.equal(comparePixels(source, await page.screenshot()).metrics.changedPixels, 0, label + '/' + size + '/frontend');
    }
  }
});

test('reverse wrapping Hug height measures the same source-order lines used by placement', async t => {
  const browser = await chromium.launch(); t.after(() => browser.close()); const page = await browser.newPage({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
  for (const wrap of ['wrap', 'wrap-reverse']) {
    const config = { axis: 'horizontal', reverse: true, wrap, hug: true, size: 306 };
    let expected = await capture(page, cssFixture(config)), value = canonical(config, expected);
    for (const size of [306, 246, 306]) {
      expected = await capture(page, cssFixture({ ...config, size })); const pixels = await page.screenshot();
      value.nodes[0].width = size; applyAllAutoLayouts(value.nodes); assertGeometry(value, expected, wrap + '/' + size);
      assert.equal(value.nodes[0].height, expected.frame.height);
      value = normalizeDesignDocument(JSON.parse(serializeDesignDocument(value))); assert.equal(applyAllAutoLayouts(value.nodes), false);
      await page.setContent(svgPage(value)); assert.equal(comparePixels(pixels, await page.screenshot()).metrics.changedPixels, 0);
    }
  }
});

test('production captured unique-color row/column reverse groups survive only-outer resize and reopen', async t => {
  const output = await mkdtemp(join(tmpdir(), 'flex-reverse-production-')); t.after(() => rm(output, { recursive: true, force: true }));
  const cases = ['row', 'column'].flatMap(axis => ['wrap', 'wrap-reverse'].map(wrap => ({ id: `${axis}-${wrap}`,
    html: '<main id="fixture">' + colors.slice(0, 4).map((color, index) => `<div class="item" id="item-${index}" style="background:${color}"></div>`).join('') + '</main>',
    css: `#fixture{display:flex;flex-direction:${axis}-reverse;flex-wrap:${wrap};width:100%;height:${axis === 'row' ? 'auto' : '240px'};align-content:stretch;background:#eeeeee}.item{width:${axis === 'row' ? '180px' : '30px'};height:${axis === 'row' ? '30px' : '100px'};${axis === 'row' ? 'margin-top' : 'margin-left'}:16px;flex-shrink:0}`,
  })));
  const report = await runProductionFidelity({ output, cases, resizeMode: 'viewport-only' });
  assert.equal(report.passed, true, JSON.stringify(report.cases.map(c => ({ id: c.id, comparisons: c.comparisons }))));
  for (const result of report.cases) for (const mode of ['imported', 'narrow']) {
    const value = normalizeDesignDocument(JSON.parse(await readFile(join(output, result.id, mode + '.codesign.json'))));
    const main = value.nodes.find(n => n.name === 'main#fixture'); assert.equal(main.layoutReverse, true); assert.notEqual(main.layout, 'none');
    const before = serializeDesignDocument(value); assert.equal(applyAllAutoLayouts(value.nodes), false, result.id + '/' + mode + '/first'); assert.equal(applyAllAutoLayouts(value.nodes), false, result.id + '/' + mode + '/second'); assert.equal(serializeDesignDocument(value), before);
  }
});
