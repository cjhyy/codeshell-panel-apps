import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { runProductionFidelity, comparePixels } from "../../../scripts/design-studio-production-fidelity.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";

// The production runner uses the same Playwright object for its own browser.
const launch = chromium.launch.bind(chromium);
chromium.launch = (options = {}) => launch({ ...options, args: [...(options.args ?? []), '--disable-gpu'] });

const rowHtml = '<main id="fixture">' + '<div class="item"></div>'.repeat(6) + '</main>';
const rowCss = '#fixture{display:flex;flex-wrap:wrap;width:100%;background:#eeeeee}.item{width:100px;height:30px;margin-top:16px;flex-shrink:0;background:#2563eb}';

test("ordinary Flex cross margins survive the upstream normal/center drop without adding wrappers", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-flex-cross-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const result = await runProductionFidelity({ output, resizeMode: "viewport-only", cases: [
    { id: "normal", html: rowHtml, css: rowCss },
    { id: "center", html: rowHtml, css: rowCss + '#fixture{align-items:center}' },
    { id: "fixed-center", html: rowHtml, css: rowCss + '#fixture{height:240px;align-items:center;align-content:center}' },
    { id: "fixed-end", html: rowHtml, css: rowCss + '#fixture{height:240px;align-items:flex-end;align-content:flex-end}' },
    { id: "reverse", html: rowHtml, css: rowCss + '#fixture{flex-direction:row-reverse}.item:nth-child(2n){background:#dc2626}' },
    { id: "wrap-reverse", html: rowHtml, css: rowCss + '#fixture{flex-wrap:wrap-reverse}.item:nth-child(2n){background:#dc2626}' },
    { id: "auto-cross", html: rowHtml, css: rowCss + '.item{height:auto;padding:8px}' },
    { id: "column", html: '<main id="fixture">' + '<div class="item"></div>'.repeat(4) + '</main>',
      css: '#fixture{display:flex;flex-direction:column;flex-wrap:wrap;width:100%;height:240px;background:#eeeeee}.item{width:30px;height:100px;margin-left:16px;flex-shrink:0;background:#2563eb}' },
    { id: "column-reverse", html: '<main id="fixture">' + '<div class="item"></div>'.repeat(4) + '</main>',
      css: '#fixture{display:flex;flex-direction:column-reverse;flex-wrap:wrap;width:100%;height:240px;background:#eeeeee}.item{width:30px;height:100px;margin-left:16px;flex-shrink:0;background:#2563eb}.item:nth-child(2n){background:#dc2626}' },
  ] });
  assert.equal(result.passed, true, JSON.stringify(result.cases.map(c => ({ id: c.id, comparisons: c.comparisons }))));
  const browser = await chromium.launch({ args: ['--disable-gpu'] });
  t.after(() => browser.close());
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const item of result.cases) {
    const column = item.id.startsWith('column');
    assert(item.comparisons.every(c => c.changedPixels === 0 && c.maximumChannelDelta === 0));
    for (const mode of ["imported", "narrow"]) {
      const document = normalizeDesignDocument(JSON.parse(await readFile(join(output, item.id, mode + '.codesign.json'), 'utf8')));
      const main = document.nodes.find(n => n.name === 'main#fixture');
      assert.equal(main.layout, column ? 'vertical' : 'horizontal');
      assert.equal(main.layoutWrap, item.id === 'wrap-reverse' ? 'wrap-reverse' : 'wrap');
      assert.equal(main[column ? 'paddingLeft' : 'paddingTop'], 16);
      assert.equal(main[column ? 'columnGap' : 'rowGap'], 16);
      assert.equal(document.nodes.length, column ? 6 : 8);
      assert(document.nodes.every(n => n.layoutPositioning !== 'absolute'));
      const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(document)));
      assert.equal(applyAllAutoLayouts(reopened.nodes), false, item.id + '/' + mode + '/reopen');
      await page.setViewportSize({ width: mode === 'imported' ? 640 : 400, height: 240 });
      await page.setContent(exportDesignFrontend(JSON.parse(serializeDesignDocument(reopened))));
      const reference = await readFile(join(output, item.id, mode + '-source.png'));
      assert.equal(comparePixels(reference, await page.screenshot()).metrics.changedPixels, 0, item.id + '/' + mode + '/frontend');
      const ordinary = await page.locator('[data-codeshell-id]').evaluateAll(nodes => nodes
        .filter(n => n.dataset.codeshellId !== 'html-viewport')
        .map(n => getComputedStyle(n).position));
      assert(ordinary.every(position => position !== 'absolute'), 'frontend retains real Flex flow');
    }
  }
});

test("already consumed margins stay single, while lost wrapper/relative margins keep measured fallback", async (t) => {
  const output = await mkdtemp(join(tmpdir(), 'html-flex-cross-boundary-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const result = await runProductionFidelity({ output, resizeMode: 'viewport-only', recordOnly: true, cases: [
    { id: 'consumed', html: rowHtml, css: rowCss + '#fixture{align-items:stretch}' },
    { id: 'mixed-wrapper', html: rowHtml, css: rowCss + '.item{margin-left:8px}' },
    { id: 'percentage-size', html: rowHtml, css: rowCss + '.item{width:50%}' },
    { id: 'relative-margin', html: rowHtml, css: rowCss + '.item{margin-top:2%}' },
    { id: 'transformed', html: rowHtml, css: rowCss + '#fixture{transform:scale(1.1);transform-origin:top left}' },
    { id: 'transformed-ancestor', html: '<main id="fixture"><section id="inner">' + '<div class="item"></div>'.repeat(6) + '</section></main>',
      css: rowCss.replaceAll('#fixture', '#inner') + '#fixture{width:100%;transform:scale(1.1);transform-origin:top left}' },
  ] });
  for (const item of result.cases) {
    const document = normalizeDesignDocument(JSON.parse(await readFile(join(output, item.id, 'imported.codesign.json'), 'utf8')));
    const main = document.nodes.find(n => n.name === (item.id === 'transformed-ancestor' ? 'section#inner' : 'main#fixture'));
    if (item.id === 'consumed') {
      assert.equal(main.layout, 'horizontal');
      assert.equal(main.paddingTop, 0, 'existing synthetic wrappers own their padding');
      assert(item.comparisons.every(c => c.changedPixels === 0), JSON.stringify(item.comparisons));
    } else {
      assert.equal(main.layout, 'none', item.id + ' must not claim unsupported reflow');
      assert(item.warnings.some(w => w.code === 'layout-margin-fixed' && w.nodeId === main.id), item.id);
      if (item.id === 'relative-margin') {
        // Retain fractional capture/raster differences; this rejected case is
        // evidence of unchanged measured fallback, never strict pixel success.
        assert.equal(item.comparisons[0].changedPixels, item.comparisons[1].changedPixels);
        assert.equal(item.comparisons[0].maximumChannelDelta, item.comparisons[1].maximumChannelDelta);
      } else if (!item.id.startsWith('transformed')) {
        assert(item.comparisons.slice(0, 2).every(c => c.changedPixels === 0), item.id + JSON.stringify(item.comparisons));
      }
    }
  }
});
