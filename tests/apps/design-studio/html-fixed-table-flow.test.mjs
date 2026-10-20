import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { runProductionFidelity } from "../../../scripts/design-studio-production-fidelity.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { tableCss, tableHtml, tablePage, tableRows } from "../../fixtures/design-studio-html-fixed-table-flow/source.mjs";

const launch = chromium.launch.bind(chromium);
chromium.launch = (options = {}) => launch({ ...options, args: [...(options.args ?? []), "--disable-gpu"] });
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/design-studio/app");
const tag = (node) => { try { return JSON.parse(node.notes ?? "{}").tag; } catch { return undefined; } };
const sourceContext = async (t) => {
  const browser = await chromium.launch(); t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1280, height: 600 }, deviceScaleFactor: 1 });
  const blocked = [], errors = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.href === "https://fixed-table.test/") return route.fulfill({ contentType: "text/html", body: "<!doctype html>" });
    if (url.origin === "https://fixed-table.test" && url.pathname.startsWith("/app/") && url.pathname.endsWith(".mjs")) {
      const path = resolve(appRoot, url.pathname.slice(5));
      if (path.startsWith(`${appRoot}/`)) return route.fulfill({ contentType: "text/javascript", body: await readFile(path) });
    }
    blocked.push(url.href); return route.abort();
  });
  const page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("https://fixed-table.test/");
  t.after(() => { assert.deepEqual(blocked, []); assert.deepEqual(errors, []); });
  return { context, page };
};

test("fixed two-column source preserves every row/cell/P and responds to only its outer viewport", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "html-fixed-table-")); t.after(() => rm(output, { recursive: true, force: true }));
  const report = await runProductionFidelity({ output, width: 1280, height: 600, narrowWidth: 768, resizeMode: "viewport-only", recordOnly: true,
    cases: [...[1, 2, 4, 6].map((count) => ({ id: `rows-${count}`, rootSelector: "body", css: tableCss, html: tableHtml(Array.from({ length: count }, (_, index) => tableRows[index % tableRows.length])) })),
      {id:'rows-4-no-last',rootSelector:'body',css:tableCss+'dl>div:last-child{border-bottom:0}',html:tableHtml()}] });
  for (const observed of report.cases) {
    assert(observed.warnings.some((entry) => entry.code === "html-table-captured-state"), JSON.stringify(observed));
    assert(!observed.warnings.some((entry) => ['block-flow-fixed', 'html-plain-text-fixed', 'rich-text-uniform'].includes(entry.code)), 'only proved fallback warnings retire after complete admission');
    assert(observed.warnings.some((entry) => entry.code === 'collapsed-border'), 'collapsed paint/source limitation remains explicit');
    assert.deepEqual(observed.semanticIssues, []);
    assert.equal(observed.nativeTransfer.supported, true);
    const count = Number(observed.id.split('-')[1]);
    let ids;
    for (const [mode, width] of [["imported", 1280], ["narrow", 768]]) {
      const savedInput = JSON.parse(await readFile(join(output, observed.id, `${mode}.codesign.json`)));
      const value = normalizeDesignDocument(savedInput);
      const table = value.nodes.find((node) => tag(node) === 'dl'), rows = value.nodes.filter((node) => node.parentId === table.id);
      assert.equal(table.layoutSizingHorizontal, 'fill'); assert.equal(table.layoutSizingVertical, 'hug');
      assert.equal(table.width, width - 60); assert.equal(rows.length, count);
      assert(rows.every((row) => row.layout === 'grid' && row.layoutSizingHorizontal === 'fill' && row.layoutSizingVertical === 'hug'));
      for (const row of rows) {
        const cells = value.nodes.filter((node) => node.parentId === row.id);
        assert.equal(cells.length, 2);
        assert.deepEqual(cells.map((node) => node.width), [Math.round((.3 * (width-60) + 20)*100)/100, Math.round((.7 * (width-60) - 20)*100)/100]);
        assert(cells.every((cell) => cell.layoutSizingHorizontal === 'fill' && cell.layoutSizingVertical === 'fill'));
      }
      assert(value.nodes.every((node) => node.layoutPositioning !== 'absolute'));
      assert(!value.nodes.some((node) => node.textSource?.endsWith('\u00a0')), 'converter-added whitespace is replaced only from proven actual DOM text');
      const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(value)));
      assert.deepEqual(createFigmaTransfer(reopened).warnings.filter((warning) => !['notes-plugin-data', 'child-layout-export'].includes(warning.code)), []);
      const currentIds = value.nodes.map((node) => [node.id, node.parentId]);
      if (ids) assert.deepEqual(currentIds, ids); else ids = currentIds;
    }
    assert(observed.comparisons.every((item) => item.changedPixels === 0 && item.maximumChannelDelta === 0));
    t.diagnostic(`${observed.id}: strict pixel counts ${observed.comparisons.map((item) => item.changedPixels).join('/')}`);
  }
  assert.deepEqual(report.blockedRequests, []); assert.deepEqual(report.browserErrors, []);
  assert.equal(report.passed, true);
});

test("table admission refuses unproven CSS semantics and all late failures leave original nodes unchanged", async (t) => {
  const { page } = await sourceContext(t);
  const negatives = [
    ['opaque', 'dd{background:white}'], ['gradient', 'dd{background:linear-gradient(red,blue)}'],
    ['table-height', 'dl{height:46px}'], ['row-height', 'dl>div{height:46px}'], ['cell-height', 'dd{height:25px}'],
    ['min-width', 'dl{min-width:400px}'], ['max-height', 'dd{max-height:500px}'], ['aspect', 'dl{aspect-ratio:2}'],
    ['wrong-ratio', 'dt{width:31%}'], ['percent-padding', 'dt{padding-right:2%}'],
    ['spacing', 'dl{border-spacing:1px}'], ['separate', 'dl{border-collapse:separate}'],
    ['auto-table', 'dl{table-layout:auto}'], ['mixed-rule', '#row-1{border-bottom-color:red}'],
    ['double-rule', 'dt{border-top:1px solid red}'], ['top-rule', 'dl>div{border-top:1px solid red}'],
    ['zoom', 'body{zoom:2}'], ['transform', 'body{transform:translateX(10px)}'], ['relative', 'dd{position:relative;left:1px}'],
    ['manual-width-owner', 'body{column-count:2}'],
    ['row-display', '#row-1{display:block}'], ['generated', 'dd::before{content:"prefix"}'],
    ['first-line', 'dd::first-line{font-weight:700}'], ['nowrap', 'dd{white-space:nowrap}'],
    ['preformatted', 'dd{white-space:pre-wrap}'], ['decoration', 'dd{text-decoration:underline}'],
    ['anonymous-preserved-space', 'dl{white-space:pre}dt,dd{white-space:normal}'],
    ['shadow', 'dd{text-shadow:1px 1px red}'], ['hidden', '#row-1{visibility:hidden}'],
    ['paragraph-height', 'p{height:25px}'], ['paragraph-margin', 'p{margin-left:1px}'],
    ['cell-columns', 'dd{column-width:80px}'], ['paragraph-columns', 'p{column-width:80px}'],
  ];
  for (const [label, css] of negatives) {
    const observed = await page.evaluate(async ({ html }) => {
      const { captureWorkspaceHtmlResult } = await import('/app/html-import.mjs');
      const value = await captureWorkspaceHtmlResult({ sourcePath:'source.html',html,readText:async()=>{throw Error('No external resource')},rootSelector:'body',viewportWidth:1280,viewportHeight:600 });
      const all = value.document.pages.flatMap((page) => { const visit=(node)=>[node,...(node.children??[]).flatMap(visit)];return page.children.flatMap(visit); });
      return { applied: value.report.tables??[], codes:value.report.warnings.map((entry)=>entry.code), gridCount:all.filter((node)=>node.layout==='grid').length };
    }, { html:tablePage(tableRows,css) });
    assert.equal(observed.applied.length,0,label+JSON.stringify(observed));
    assert.equal(observed.gridCount,0,label);
  }
  for (const [label, body] of [
    ['anonymous-table', tableHtml().replace('<dl>','<dl>extra')],
    ['anonymous-row', tableHtml().replace('<dt>','extra<dt>')],
    ['colspan', tableHtml().replace('<dd>','<dd colspan="2">')],
    ['group', tableHtml().replace('<dl>','<dl><section>').replace('</dl>','</section></dl>')],
    ['rich', tableHtml().replace('Sarah Phillips','<strong>Sarah</strong> Phillips')],
    ['leading-br', tableHtml().replace('Sarah Phillips','<br>Sarah Phillips')],
    ['empty-line', tableHtml().replace('Sarah Phillips','Sarah<br><br>Phillips')],
    ['hidden-child', tableHtml().replace('Sarah Phillips','Sarah<span hidden>secret</span> Phillips')],
  ]) {
    const observed=await page.evaluate(async html=>{
      const {captureWorkspaceHtmlResult}=await import('/app/html-import.mjs');
      const result=await captureWorkspaceHtmlResult({sourcePath:'source.html',html,readText:async()=>'',rootSelector:'body',viewportWidth:1280,viewportHeight:600});
      return result.report.tables??[];
    },`<!doctype html><style>${tableCss}</style><body>${body}</body>`);
    assert.deepEqual(observed,[],label);
  }
  const explicitHeightHtml = tablePage([['Key','First<br>Second']], 'dl>div{height:70.5px}');
  await page.setContent(explicitHeightHtml);
  const minimumHeight = await page.evaluate(async html => {
    const row = document.querySelector('dl>div'), before = row.getBoundingClientRect().height;
    document.querySelector('dd').textContent = 'Short';
    const after = row.getBoundingClientRect().height;
    const {captureWorkspaceHtmlResult}=await import('/app/html-import.mjs');
    const result=await captureWorkspaceHtmlResult({sourcePath:'source.html',html,readText:async()=>'',rootSelector:'body',viewportWidth:1280,viewportHeight:600});
    return { before, after, applied:result.report.tables??[] };
  }, explicitHeightHtml);
  assert.deepEqual(minimumHeight,{before:70.5,after:70.5,applied:[]},'an initially equal explicit row height remains a CSS floor after copy shrinks');
  // Exercise the helper directly after source→canonical ownership capture.
  // A failure on the second row happens after the first row's draft text and
  // layout were changed; the original graph and exact source remain untouched.
  await page.setContent(tablePage(tableRows.slice(0,2),'dl{width:640px}'));
  const atomic = await page.evaluate(async()=>{
    const {convertToDesignDSL}=await import('/app/vendor/html2figma-browser.mjs');
    const {designNodeToV3}=await import('/app/design-node-adapter.mjs');
    const {promoteHtmlFixedTables}=await import('/app/html-fixed-table-flow.mjs');
    const {createBrowserTextMeasurer}=await import('/app/text-metrics.mjs');
    const elements=new Map(),source=convertToDesignDSL(document.querySelector('dl'),{onElement:(id,element)=>elements.set(id,element)}),mapping=new WeakMap();
    const value=await designNodeToV3(source,{includeViewport:false,onNode:(source,node)=>mapping.set(source,node)});
    const table=value.document.pages[0].children[0];
    // Set only test baseline projection, independently measured from this DOM.
    const measurement=createBrowserTextMeasurer();
    for(const row of table.children)for(const cell of row.children){const text=cell.children[0];measurement.configure(text);text.y=Math.round((cell.y+10+(row===table.children[0]?0:.5)+measurement.lineBoxOffset(text))*100)/100;}
    measurement.close();
    const before=JSON.stringify(value.document),sourceBefore=JSON.stringify(source),refs=table.children.flatMap(row=>[row,...row.children,...row.children.flatMap(cell=>cell.children)]),warnings=[];
    table.children[1].children[1].minHeight=1;
    const editedBefore=JSON.stringify(value.document);
    const applied=await promoteHtmlFixedTables(value.document,{browserDocument:document,elements,sourceTree:source,canonicalBySource:mapping,warn:(...entry)=>warnings.push(entry)});
    return { applied,unchanged:JSON.stringify(value.document)===editedBefore,sourceUnchanged:JSON.stringify(source)===sourceBefore,refsUnchanged:refs.every(node=>{const visit=n=>n===node||(n.children??[]).some(visit);return visit(table)}),warnings,beforeDiffers:before!==editedBefore };
  });
  assert.deepEqual(atomic.applied,[]);assert.equal(atomic.unchanged,true);assert.equal(atomic.sourceUnchanged,true);assert.equal(atomic.refsUnchanged,true);assert.equal(atomic.beforeDiffers,true);
  assert.equal(atomic.warnings[0][0],'html-table-flow-fixed');
});

test("source-bound normal/BR/multi-P text survives copy, outer resize and save/reopen without geometry repair", async (t) => {
  const { context, page } = await sourceContext(t), reference = await context.newPage();
  const html=tablePage();
  const initial=await page.evaluate(async html=>{
    const {captureWorkspaceHtmlResult}=await import('/app/html-import.mjs');
    const {normalizeDesignDocument}=await import('/app/document.mjs');
    const result=await captureWorkspaceHtmlResult({sourcePath:'source.html',html,readText:async()=>'',rootSelector:'body',viewportWidth:1280,viewportHeight:600});
    window.tableValue=normalizeDesignDocument(result.document);
    return { applied:result.report.tables, ids:window.tableValue.nodes.map(node=>[node.id,node.parentId]), text:window.tableValue.nodes.filter(node=>node.type==='text').map(node=>node.textSource) };
  },html);
  assert.equal(initial.applied.length,1);assert(initial.text.includes('Sarah Phillips'));assert(initial.text.includes('72 Guild Street\nLondon\nSE23 6FH'));
  for(const [width,copy] of [[1280,'07700 900457'],[768,'This ordinary paragraph has enough real words to grow across multiple lines after only its outer viewport becomes narrower.'],[1280,'07700 900457']]){
    await reference.setViewportSize({width,height:600});await reference.setContent(html);await reference.locator('p').first().evaluate((node,copy)=>{node.textContent=copy},copy);
    const expected=await reference.evaluate(()=>({table:document.querySelector('dl').getBoundingClientRect().toJSON(),rows:[...document.querySelectorAll('dl>div')].map(row=>({row:row.getBoundingClientRect().toJSON(),cells:[...row.children].map(cell=>cell.getBoundingClientRect().toJSON())})),paragraphs:[...document.querySelectorAll('p')].map(node=>node.getBoundingClientRect().toJSON())}));
    const observed=await page.evaluate(async({width,copy})=>{
      const {createBrowserTextMeasurer}=await import('/app/text-metrics.mjs');const {applyAllAutoLayouts}=await import('/app/layout.mjs');
      const {serializeDesignDocument,normalizeDesignDocument}=await import('/app/document.mjs');const {createFigmaTransfer}=await import('/app/figma-bridge.mjs');
      let value=window.tableValue;value.nodes.find(node=>node.id==='html-viewport').width=width;
      value.nodes.find(node=>node.type==='text'&&node.textSource.startsWith('07700')||node.type==='text'&&node.name==='07700 900457').textSource=copy;
      const measure=createBrowserTextMeasurer();try{applyAllAutoLayouts(value.nodes,{textMeasurer:measure})}finally{measure.close()}
      const saved=serializeDesignDocument(value);value=normalizeDesignDocument(JSON.parse(saved));
      const second=createBrowserTextMeasurer();try{applyAllAutoLayouts(value.nodes,{textMeasurer:second})}finally{second.close()}
      const stable=serializeDesignDocument(value)===saved;window.tableValue=value;
      const tag=node=>{try{return JSON.parse(node.notes??'{}').tag}catch{return undefined}};
      const table=value.nodes.find(node=>tag(node)==='dl'),rows=value.nodes.filter(node=>node.parentId===table.id);
      return{stable,ids:value.nodes.map(node=>[node.id,node.parentId]),table,rows:rows.map(row=>({row,cells:value.nodes.filter(node=>node.parentId===row.id)})),paragraphs:value.nodes.filter(node=>tag(node)==='p'&&node.type==='frame'),warnings:createFigmaTransfer(value).warnings.map(warning=>warning.code)};
    },{width,copy});
    assert.equal(observed.stable,true);assert.deepEqual(observed.ids,initial.ids);
    assert.equal(observed.table.height,expected.table.height);assert.equal(observed.table.width,width-60);
    for(let rowIndex=0;rowIndex<4;rowIndex++){
      const row=observed.rows[rowIndex],source=expected.rows[rowIndex];
      assert.deepEqual([row.row.y,row.row.height],[source.row.y,source.row.height]);
      for(let column=0;column<2;column++)assert.deepEqual([row.cells[column].y,row.cells[column].height],[source.cells[column].y,source.cells[column].height]);
    }
    assert.deepEqual(observed.paragraphs.map(node=>[node.y,node.height]),expected.paragraphs.map(node=>[node.y,node.height]));
    assert(observed.warnings.every(code=>['notes-plugin-data','child-layout-export'].includes(code)));
    if(width===768)assert.notEqual(observed.rows[0].cells[0].width,expected.rows[0].cells[0].width,'known CSS/native fractional quantization remains an exact failure, never normalized into proof');
  }
  // Real authored NBSP survives; only ASCII whitespace collapses. Explicit BR
  // remains a source newline independently of the converter's soft wraps.
  const nbsp=await page.evaluate(async html=>{const{captureWorkspaceHtmlResult}=await import('/app/html-import.mjs');const r=await captureWorkspaceHtmlResult({sourcePath:'source.html',html,readText:async()=>'',rootSelector:'body',viewportWidth:1280,viewportHeight:600});const visit=n=>[n,...(n.children??[]).flatMap(visit)];return r.document.pages[0].children.flatMap(visit).filter(n=>n.type==='text').map(n=>n.textSource)},tablePage([['Key','  Authored\u00a0space \n next  ']]));
  assert(nbsp.includes('Authored\u00a0space next'));
});
