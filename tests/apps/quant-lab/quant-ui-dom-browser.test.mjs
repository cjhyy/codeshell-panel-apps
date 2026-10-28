// Run in the normal Host Chromium environment. All requests are fixture-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

test('real DOM quote patches preserve open details, focused button and event listeners', async () => {
  const module = await readFile(new URL('../../../apps/quant-lab/app/modules/holdings-dom-patch.mjs', import.meta.url), 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://quant-dom.test') return route.abort();
      return route.fulfill(url.pathname === '/patch.mjs'
        ? { contentType: 'text/javascript', body: module }
        : { contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    });
    const page = await context.newPage();
    await page.goto('https://quant-dom.test/');
    const result = await page.evaluate(async () => {
      const { patchHoldingsNode } = await import('/patch.mjs');
      function row(price) {
        const node = document.createElement('article');
        node.innerHTML = `<p data-patch-key="price">${price}</p><details data-patch-key="provenance"><summary>查看行情来源与时点</summary><p>供应商参考价</p></details><button data-patch-key="note">记录笔记</button>`;
        return node;
      }
      const original = row('12 CNY'); document.body.append(original);
      const details = original.querySelector('details'), button = original.querySelector('button');
      details.open = true; button.focus(); let clicks = 0;
      button.addEventListener('click', () => { clicks++; });
      patchHoldingsNode(original, row('12 CNY'));
      patchHoldingsNode(original, row('13 CNY'));
      button.click();
      return { sameDetails: original.querySelector('details') === details, open: details.open,
        sameButton: original.querySelector('button') === button, focused: document.activeElement === button,
        price: original.querySelector('p').textContent, clicks };
    });
    assert.deepEqual(result, { sameDetails: true, open: true, sameButton: true, focused: true, price: '13 CNY', clicks: 1 });
    await context.close();
  } finally { await browser.close(); }
});
