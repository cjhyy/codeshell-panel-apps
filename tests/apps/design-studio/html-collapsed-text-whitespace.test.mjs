import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { build } from "esbuild";
import { designNodeToV3 } from "../../../apps/design-studio/app/design-node-adapter.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { runProductionFidelity } from "../../../scripts/design-studio-production-fidelity.mjs";
import { htmlPluginHarness } from "./fixtures/html-plugin-harness.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const runtime = await readFile(new URL("../../../apps/design-studio/app/vendor/html2figma-browser.mjs", import.meta.url), "utf8");
const original = (await build({
  stdin: { contents: 'import {traverseDOM} from "./third-party/html2figma/upstream/packages/browser/traverser/core"; import {renderToDesignDSL} from "./third-party/html2figma/upstream/packages/browser/converter/convert"; export const convertOriginal = root => renderToDesignDSL(traverseDOM(root), {includeRawStyles:true,maxDepth:100});', resolveDir: root },
  bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
  alias: {
    "@html2figma/shared/utils": join(root, "third-party/html2figma/upstream/packages/shared/utils.ts"),
    "@html2figma/shared/css-utils": join(root, "third-party/html2figma/upstream/packages/shared/css-utils.ts"),
    "@html2figma/shared": join(root, "third-party/html2figma/integration/shared.ts"),
  },
})).outputFiles[0].text;
const flatten = (node) => [node, ...(node.children ?? []).flatMap(flatten)];
const box = (node) => ({ tag:node.tag, type:node.nodeType, bounds:node.bounds, content:node.content,
  positioning:node.positioning, textStyle:node.textStyle, background:node.background, border:node.border,
  children:node.children?.map(box) });
const byId = (tree, id) => flatten(tree).filter((node) => node.semantic?.attributes?.id === id);
const source = (markup = '\n  Alpha Beta\n ', extra = '') => `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;background:white}#fixture{position:relative;width:100%;height:180px;padding:20px;font:20px/24px Arial}.copy{color:#123456}${extra}</style><main id="fixture"><a id="copy" class="copy" href="#">${markup}</a></main>`;
async function setup(t) {
  const browser = await chromium.launch({args:["--disable-gpu"]}); t.after(() => browser.close());
  const page = await browser.newPage({viewport:{width:640,height:180},deviceScaleFactor:1});
  await page.route("**/*", (route) => route.abort());
  return page;
}
async function capture(page) {
  return page.evaluate(async ({runtime,original}) => {
    const url = URL.createObjectURL(new Blob([runtime], {type:"text/javascript"}));
    const originalUrl = URL.createObjectURL(new Blob([original], {type:"text/javascript"}));
    try {
      const {convertToDesignDSL} = await import(url), {convertOriginal} = await import(originalUrl);
      const before = document.documentElement.outerHTML, element = document.querySelector('#copy'), raw = element.textContent;
      const tail = /[\t\n\f\r ]+$/u.exec(element.firstChild?.textContent ?? '');
      let trailingWidths;
      if (tail && element.firstChild.nodeType === 3) {
        const range = document.createRange(); range.setStart(element.firstChild,tail.index); range.setEnd(element.firstChild,element.firstChild.length);
        trailingWidths = [...range.getClientRects()].map(rect=>rect.width);
      }
      const tree = convertToDesignDSL(document.querySelector('#fixture'));
      return {tree,original:convertOriginal(document.querySelector('#fixture')),raw,trailingWidths,
        unchanged:before===document.documentElement.outerHTML};
    } finally { URL.revokeObjectURL(url); URL.revokeObjectURL(originalUrl); }
  }, {runtime,original});
}

test("only discarded ASCII suffix loses the pinned synthetic NBSP; raw bytes, styles and geometry survive reopen", async (t) => {
  const page = await setup(t);
  for (const width of [640,400,640]) {
    await page.setViewportSize({width,height:180});
    for (const css of ['', '.copy{white-space:nowrap}', '.copy::after{content:"";position:absolute;inset:0}']) {
      await page.setContent(source('\n  Alpha Beta\n ',css));
      const captured = await capture(page);
      assert.equal(captured.unchanged,true); assert.deepEqual(captured.trailingWidths,[0]);
      const text = byId(captured.tree,'copy').find(node=>node.nodeType==='text');
      const old = byId(captured.original,'copy').find(node=>node.nodeType==='text');
      assert.equal(old.content,'Alpha Beta\u00a0'); assert.equal(text.content,'Alpha Beta');
      assert.deepEqual(text.bounds,old.bounds); assert.deepEqual(text.textStyle,old.textStyle);
      assert.equal(text.cssTextWhitespace.rawSource,captured.raw);
      assert.equal(flatten(captured.tree).some(node=>node.tag==='::after'),false);
      const converted = await designNodeToV3(captured.tree,{viewportWidth:width,viewportHeight:180});
      const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(normalizeDesignDocument(converted.document))));
      const saved = reopened.nodes.find(node=>node.type==='text');
      assert.equal(saved.text,'Alpha Beta');
      assert.equal(JSON.parse(saved.notes).htmlTextOriginal.rawSource,captured.raw);
      const transfer = createFigmaTransfer(reopened);
      assert.equal(transfer.pages.flatMap(page=>page.children.flatMap(flatten)).find(node=>node.type==='text').text,'Alpha Beta');
      assert.equal(converted.report.warnings.filter(w=>w.code==='html-empty-pseudo-hit-area').length,css.includes('::after')?1:0);
    }
  }
});

test("authored NBSP, inline boundary spaces, BR, preserved whitespace and generated/painted pseudo boxes remain untouched", async (t) => {
  const page = await setup(t);
  const controls = [
    ['authored-nbsp','Alpha\u00a0 ',''], ['em-space','Alpha\u2003 ',''], ['joiner','Alpha\u200dBeta ',''],
    ['inline-boundary','Alpha </a><span>Beta</span><a hidden>',''],
    ['mixed-inline','Alpha <span>Beta</span> ',''], ['br','Alpha<br>Beta ',''],
    ['pre',' Alpha\n Beta ','.copy{white-space:pre}'], ['pre-wrap',' Alpha\n Beta ','.copy{white-space:pre-wrap}'],
    ['pre-line',' Alpha\n Beta ','.copy{white-space:pre-line}'],
    ['raw-budget','Alpha '+ ' '.repeat(1001),''], ['escaped-budget','Alpha'+ '\n'.repeat(600),''],
    ['font-budget',' Alpha Beta ','.copy{font-family:"'+ 'x'.repeat(257)+'"}'],
    ['rtl',' Alpha Beta ','.copy{direction:rtl}'], ['transform-text',' Alpha Beta ','.copy{text-transform:uppercase}'],
    ...[
      ['glyph','content:"!"'], ['flow-empty','position:relative'], ['background','background:red'],
      ['image','background-image:linear-gradient(red,blue)'], ['border','border:1px solid red'],
      ['outline','outline:1px solid red'], ['shadow','box-shadow:1px 1px red'], ['text-shadow','text-shadow:1px 1px red'],
      ['filter','filter:blur(1px)'], ['backdrop','backdrop-filter:blur(1px)'], ['mask','mask-image:linear-gradient(red,blue)'],
      ['clip','clip-path:inset(1px)'], ['transform','transform:translateX(1px)'], ['blend','mix-blend-mode:multiply'],
      ['scrollbars','overflow:scroll'], ['resize','overflow:auto;resize:both'],
      ['marker','display:list-item;list-style-type:disc'], ['appearance','appearance:auto'], ['decoration','text-decoration:underline'],
    ].map(([id,css])=>[id,'\n Alpha Beta\n ',`.copy::after{content:"";position:absolute;inset:0;${css}}`]),
  ];
  for (const [id,markup,css] of controls) {
    await page.setContent(source(markup,css));
    const observed = await capture(page);
    assert.equal(observed.unchanged,true,id);
    assert.deepEqual(box(observed.tree),box(observed.original),id);
    assert(!flatten(observed.tree).some(node=>node.cssTextWhitespace),id);
    if (id==='inline-boundary') assert(observed.trailingWidths.some(width=>width>0),'real inline spacing has nonzero browser extent');
  }
});

test("production removes only the extra underline extent; original underline rounding residual remains explicit", async (t) => {
  const output = await mkdtemp(join(tmpdir(),'html-collapsed-whitespace-'));t.after(()=>rm(output,{recursive:true,force:true}));
  const report = await runProductionFidelity({output,cpuOnly:true,recordOnly:true,resizeMode:'viewport-only',height:180,cases:[
    {id:'normal',source:source()}, {id:'nowrap',source:source('\n  Alpha Beta\n ','.copy{white-space:nowrap}')},
    {id:'undecorated-control',source:source('\n  Alpha Beta\n ','.copy{text-decoration:none}')},
    {id:'empty-after',source:source('\n  Alpha Beta\n ','.copy::after{content:"";position:absolute;inset:0}')},
  ]});
  for (const observed of report.cases) {
    if (observed.id === 'undecorated-control')
      assert(observed.comparisons.every(c=>c.changedPixels===0&&c.maximumChannelDelta===0),JSON.stringify(observed));
    else t.diagnostic(`${observed.id}: full strict changed/max ${observed.comparisons.map(c=>`${c.changedPixels}/${c.maximumChannelDelta}`).join(', ')}; nonzero underline rounding remains a failed strict comparison`);
    for (const comparison of observed.comparisons) {
      const reference = PNG.sync.read(await readFile(join(output,observed.id,`${comparison.mode}-source.png`)));
      const converted = PNG.sync.read(await readFile(join(output,observed.id,`${comparison.mode}-converted.png`)));
      let rightmostSourcePaint = -1;
      for (let offset=0; offset<reference.data.length; offset+=4)
        if ([0,1,2].some(channel=>reference.data[offset+channel]!==255))
          rightmostSourcePaint=Math.max(rightmostSourcePaint,offset/4%reference.width);
      assert(rightmostSourcePaint>0);
      for (let offset=0; offset<converted.data.length; offset+=4)
        if (offset/4%converted.width>rightmostSourcePaint)
          assert.deepEqual(converted.data.subarray(offset,offset+4),reference.data.subarray(offset,offset+4),
            `${observed.id}/${comparison.mode}: synthetic NBSP must not extend underline past actual source paint`);
      if (comparison.changedPixels) assert.equal(comparison.passed,false,'known residual is not a strict pass');
    }
    const value=normalizeDesignDocument(JSON.parse(await readFile(join(output,observed.id,'imported.codesign.json'))));
    const text=value.nodes.find(node=>node.type==='text');assert.equal(text.textSource,'Alpha Beta');
    assert.equal(JSON.parse(text.notes).htmlTextOriginal.rawSource,'\n  Alpha Beta\n ');
  }
  assert.deepEqual(report.blockedRequests,[]);assert.deepEqual(report.browserErrors,[]);
});


test("duplicate selectors retain their own actual Text sources and bounded raw receipts survive oversized attributes", async (t) => {
  const page = await setup(t);
  await page.setContent(source().replace('<a id="copy" class="copy" href="#">\n  Alpha Beta\n </a>',
    '<p><a id="copy" href="#">\n First\n </a></p><p><a id="copy" href="#">\n Second\n </a></p>'));
  const duplicate = await capture(page), texts = flatten(duplicate.tree).filter(node=>node.nodeType==='text');
  assert.deepEqual(texts.map(node=>[node.content,node.cssTextWhitespace.rawSource]),[['First','\n First\n '],['Second','\n Second\n ']]);
  await page.setContent(source().replace('class="copy"',`class="copy ${'x'.repeat(2000)}"`));
  const long = await capture(page), converted = await designNodeToV3(long.tree);
  const text = normalizeDesignDocument(converted.document).nodes.find(node=>node.type==='text');
  assert.equal(text.text,'Alpha Beta');
  assert.equal(JSON.parse(text.notes).htmlTextOriginal.rawSource,'\n  Alpha Beta\n ');
  assert(text.notes.length<=2000);
  assert(converted.report.warnings.some(w=>w.code==='semantic-notes-limit'));
  // Exercise the real standalone mapper with untrusted JSON carrying a valid
  // small source record but an oversized final child snapshot. No correction is
  // admitted from that record and no existing source field may be rewritten.
  const untrusted = structuredClone(long.tree);
  const container = byId(untrusted, 'copy').find(node=>node.nodeType==='container');
  const capturedText = container.children[0];
  container.children = Array.from({length:80},(_,index)=>{
    const child=structuredClone(capturedText);child.id=`oversize-${index}`;
    child.content='x'.repeat(200);delete child.cssTextWhitespace;return child;
  });
  const original=JSON.stringify(untrusted), harness=htmlPluginHarness();
  const result=await harness.importDesign(untrusted);
  assert.equal(result.type,'import-success',result.message);
  assert(result.warnings.some(warning=>/8000 UTF-16/u.test(warning)));
  assert.equal(harness.nodes.filter(node=>node.characters==='x'.repeat(200)).length,80);
  assert.equal(JSON.stringify(untrusted),original,'the actual mapper leaves untrusted source payload unchanged');
  assert(!harness.nodes.some(node=>node.metadata?.['html2figma:htmlTextWhitespace']));
});
