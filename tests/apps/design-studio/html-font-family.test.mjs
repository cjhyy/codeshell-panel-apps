import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";

const appRoot = new URL('../../../apps/design-studio/app/', import.meta.url);
const fontBytes = await readFile(new URL('fonts/InterVariable.woff2', appRoot));
const font = {family:'Inter',weight:400,style:'normal',mime:'font/woff2',base64:fontBytes.toString('base64')};
const markup = (family='"Inter", system-ui', content='Exact source family', extra='') =>
  `<!doctype html><meta charset="utf-8"><style>@font-face{font-family:Inter;font-weight:400;src:url(data:font/woff2;base64,${font.base64})}*{box-sizing:border-box}html,body{margin:0}#fixture{width:640px;padding:20px}#copy{margin:0;font:400 20px/1.5 ${family}}${extra}</style><main id="fixture"><p id="copy">${content}</p></main>`;

async function setup(t) {
  const browser = await chromium.launch({args:['--disable-gpu']}); t.after(()=>browser.close());
  const page = await browser.newPage({viewport:{width:640,height:240},deviceScaleFactor:1});
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://font-fixture.test') return route.abort();
    if (url.pathname === '/') return route.fulfill({contentType:'text/html',body:'<!doctype html>'});
    if (!/^\/app\/[a-z0-9/_.-]+\.mjs$/iu.test(url.pathname) || url.pathname.includes('..')) return route.abort();
    return route.fulfill({contentType:'text/javascript',body:await readFile(new URL(url.pathname.slice(5),appRoot))});
  });
  await page.goto('https://font-fixture.test/');
  return page;
}

async function proof(page, html, mutation = 'none', alias = 'Inter') {
  await page.setContent(html); await page.evaluate(()=>document.fonts.ready);
  return page.evaluate(async ({font, mutation, alias}) => {
    const {convertToDesignDSL}=await import('/app/vendor/html2figma-browser.mjs');
    const {designNodeToV3}=await import('/app/design-node-adapter.mjs');
    const {captureHtmlFontFamilyElement,captureHtmlFontFamilyTextProjection,preserveHtmlFontFamilies}=await import('/app/html-font-family.mjs');
    const {normalizeDesignDocument,serializeDesignDocument,exportDesignSvg}=await import('/app/document.mjs');
    const root=document.querySelector('#fixture'), element=document.querySelector('#copy');
    const originalHtml=document.documentElement.outerHTML;
    const elements=new Map(),records=new WeakMap(),ambiguousElements=new WeakSet(),canonicalBySource=new WeakMap();
    const tree=convertToDesignDSL(root,{onElement:(id,current)=>{
      if(!elements.has(id))elements.set(id,current);else if(elements.get(id)!==current){ambiguousElements.add(current);ambiguousElements.add(elements.get(id));elements.set(id,null);}
      if(!records.has(current))records.set(current,captureHtmlFontFamilyElement(current));
    }});
    const flat=source=>[source,...(source.children??[]).flatMap(flat)];
    const textBindings=[];
    const adapted=await designNodeToV3(tree,{fonts:[{...font,family:alias}],viewportWidth:640,viewportHeight:240,
      onNode:(source,node)=>{canonicalBySource.set(source,node);if(node.type==='text'){
        if(!['unregistered','manufactured-notes'].includes(mutation))captureHtmlFontFamilyTextProjection(source,node);
        textBindings.push({source,node});
      }}});
    // The mixed-descendant negative can be an upstream merged text without a
    // semantic leaf binding. Inspect its first text; product admission must refuse it.
    const binding=textBindings.find(({source})=>elements.get(source.semantic?.semanticId)===element)??textBindings[0];
    const {source,node}=binding, before=JSON.stringify(node), sourceBefore=JSON.stringify(tree);
    if(mutation==='replace')element.replaceWith(element.cloneNode(true));
    if(mutation==='font')element.style.fontFamily='Arial, serif';
    if(mutation==='text')element.firstChild.data='Changed live source';
    if(mutation==='foreign'){const other=document.createElement('p');other.textContent=element.textContent;document.body.append(other);elements.set(source.semantic.semanticId,other);records.set(other,captureHtmlFontFamilyElement(other));}
    if(mutation==='ambiguous')ambiguousElements.add(element);
    if(mutation==='source-style')source.textStyle.fontFamily='Foreign';
    if(mutation==='source-content')source.content='Changed upstream projection';
    if(mutation==='source-weight')source.textStyle.fontWeight=900;
    if(mutation==='canonical-text')node.text='Changed canonical display';
    if(mutation==='canonical-source')node.textSource='Changed canonical source';
    if(mutation==='manufactured-notes')node.notes=JSON.stringify({htmlText:{whiteSpace:'pre',rawSource:element.textContent}});
    const warnings=[];
    const result=preserveHtmlFontFamilies({tree,root,elements,records,ambiguousElements,canonicalBySource,textBindings,
      resources:adapted.document.resources,warn:(code,nodeId,message)=>warnings.push({code,nodeId,message})});
    const saved=serializeDesignDocument(normalizeDesignDocument(adapted.document));
    const reopened=normalizeDesignDocument(JSON.parse(saved)), text=reopened.nodes.find(n=>n.id===node.id);
    const resources=new Map(adapted.resourcePlans.map(p=>[p.descriptor.id,`data:${p.descriptor.mime};base64,${font.base64}`]));
    const svg=exportDesignSvg(reopened,{resourceDataUrls:resources,maxBytes:4*1024*1024});
    const baseline=JSON.parse(before), current=JSON.parse(JSON.stringify(node));
    for(const value of [baseline,current]){delete value.fontFamily;delete value.fontRef;}
    return {result,warnings,expectedFamily:getComputedStyle(element).fontFamily,sourceContent:source.content,
      family:node.fontFamily,fontRef:node.fontRef,resource:adapted.document.resources.find(r=>r.id===node.fontRef),
      oldFamily:JSON.parse(before).fontFamily,otherPropertiesUnchanged:JSON.stringify(baseline)===JSON.stringify(current),
      sourceTreeUnchanged:sourceBefore===JSON.stringify(tree),originalDomUnchanged:originalHtml===document.documentElement.outerHTML,
      reopenedFamily:text.fontFamily,reopenedText:text.textSource,saved,svg};
  },{font,mutation,alias});
}

test('full real leaf family is restored before measurement and survives save/reopen with verified local font bytes', async t => {
  const page=await setup(t);
  const p=await proof(page,markup());
  assert.equal(p.family,p.expectedFamily);assert.equal(p.reopenedFamily,p.expectedFamily);
  assert.equal(p.family,'Inter, system-ui');assert.equal(p.result.restored,1);
  assert.equal(p.resource.family,'Inter');assert.equal(p.resource.sha256,'693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3');
  assert(p.otherPropertiesUnchanged&&p.sourceTreeUnchanged&&p.originalDomUnchanged);
  assert(p.svg.includes('font-family="&quot;Inter&quot;, system-ui"'));
  const doc=normalizeDesignDocument(JSON.parse(p.saved));
  assert.throws(()=>createFigmaTransfer(doc),{code:'NATIVE_CSS_FONT_FAMILY'});
  doc.nodes.find(n=>n.type==='text').fontFamily='Inter';
  const flatten=n=>[n,...(n.children??[]).flatMap(flatten)];
  assert.equal(createFigmaTransfer(doc).pages.flatMap(p=>p.children.flatMap(flatten)).find(n=>n.type==='text').fontFamily,'Inter');
});

test('quoted comma/escaped literal local face names preserve resource identity and CSS list boundaries', async t => {
  const page=await setup(t);
  for(const [css,alias] of [['"Local, Family", serif','Local, Family'],['"Local\\\"Quote", monospace','Local"Quote'],['"serif", sans-serif','serif']]) {
    const declaration=css.slice(0,css.lastIndexOf(','));
    const html=markup(css).replace('@font-face{font-family:Inter;',`@font-face{font-family:${declaration};`);
    const p=await proof(page,html,'none',alias);
    assert.equal(p.family,p.expectedFamily,css);assert.equal(p.reopenedFamily,p.expectedFamily,css);
    assert.equal(p.resource.family,alias,css);assert(p.fontRef,css);
    assert(p.otherPropertiesUnchanged&&p.sourceTreeUnchanged&&p.originalDomUnchanged,css);
    assert.throws(()=>createFigmaTransfer(normalizeDesignDocument(JSON.parse(p.saved))),{code:'NATIVE_CSS_FONT_FAMILY'});
  }
});

test('same-looking replacements, foreign/ambiguous bindings and source races cannot promote a family', async t => {
  const page=await setup(t);
  for(const mutation of ['replace','font','text','foreign','ambiguous','source-style']) {
    const p=await proof(page,markup(),mutation);
    assert.equal(p.family,p.oldFamily,mutation);assert.equal(p.result.restored,0,mutation);
    assert.equal(p.result.retained,1,mutation);assert(p.warnings.some(w=>w.code==='html-font-family-unverified'),mutation);
    assert(p.otherPropertiesUnchanged,mutation);
  }
});

test('over-budget, mixed descendants and variant-family text retain explicit scoped fallback', async t => {
  const page=await setup(t);
  for(const html of [markup('"'+'x'.repeat(121)+'", serif'),markup('Inter, system-ui','Mixed <em>child</em>'),
    markup('Inter, system-ui','Family variant','#copy::first-line{font-family:serif}')]) {
    const p=await proof(page,html);
    assert.equal(p.family,p.oldFamily);assert.equal(p.result.restored,0);
    assert(p.warnings.some(w=>['html-font-family-unverified','html-font-family-budget'].includes(w.code)));
    assert(p.otherPropertiesUnchanged&&p.sourceTreeUnchanged&&p.originalDomUnchanged);
  }
});

test('production capture uses current full family in browser metric receipts without editing source characters', async t => {
  const page=await setup(t);
  const html=markup('Inter, system-ui','Exact source with NBSP '+String.fromCodePoint(0xa0)+' preserved');
  const p=await page.evaluate(async html=>{
    const {captureWorkspaceHtmlResult}=await import('/app/html-import.mjs');
    const {normalizeDesignDocument,serializeDesignDocument}=await import('/app/document.mjs');
    const r=await captureWorkspaceHtmlResult({html,sourcePath:'source.html',readText:async()=>'',rootSelector:'#fixture',viewportWidth:640,viewportHeight:240});
    const d=normalizeDesignDocument(r.document),text=d.nodes.find(n=>n.type==='text');
    return {fontFamilies:r.report.fontFamilies,family:text.fontFamily,signature:JSON.parse(text.textMetrics.signature),
      sourceSignature:JSON.parse(text.textMetrics.sourceSignature),text:text.text,textSource:text.textSource,
      reopened:normalizeDesignDocument(JSON.parse(serializeDesignDocument(d))).nodes.find(n=>n.type==='text')};
  },html);
  assert.equal(p.fontFamilies.restored,1);assert.equal(p.family,'Inter, system-ui');
  assert.equal(p.signature[1],p.family);assert.equal(p.sourceSignature[1],p.family);
  assert.equal(p.reopened.fontFamily,p.family);assert.equal(p.reopened.textSource,p.textSource);
  assert(p.textSource.includes(String.fromCodePoint(0xa0)));assert.equal(p.textSource,p.text);
});

test('owned pre recovery retains literal spaces, NBSP and LF while refusing stale or manufactured projection authority', async t => {
  const page=await setup(t);
  const raw=String.fromCodePoint(0xa0)+'  First  literal line\n\nSecond literal line.  '+String.fromCodePoint(0xa0);
  const html=markup('Inter, system-ui',raw,'#copy{white-space:pre;overflow:hidden;text-overflow:clip;width:280px}');
  const positive=await proof(page,html);
  assert.notEqual(positive.sourceContent,raw,'actual upstream pre projection must differ from restored raw bytes');
  assert.equal(positive.family,positive.expectedFamily);assert.equal(positive.reopenedText,raw);
  assert.equal(positive.result.restored,1);assert.equal(positive.result.retained,0);
  assert(positive.otherPropertiesUnchanged&&positive.sourceTreeUnchanged&&positive.originalDomUnchanged);
  assert(!positive.warnings.some(w=>w.code==='html-font-family-unverified'));
  for(const mutation of ['source-content','source-weight','canonical-text','canonical-source','unregistered','manufactured-notes']) {
    const p=await proof(page,html,mutation);
    assert.equal(p.family,p.oldFamily,mutation);assert.equal(p.result.restored,0,mutation);
    assert.equal(p.result.retained,1,mutation);assert(p.warnings.some(w=>w.code==='html-font-family-unverified'),mutation);
  }
});

test('production pre recovery preserves current full family and raw bytes through measurement and reopen', async t => {
  const page=await setup(t),raw='  First  literal line\n\nSecond '+String.fromCodePoint(0xa0)+' literal line.  ';
  const html=markup('Inter, system-ui',raw,'#copy{white-space:pre;overflow:hidden;text-overflow:clip;width:280px}');
  const p=await page.evaluate(async html=>{
    const {captureWorkspaceHtmlResult}=await import('/app/html-import.mjs');
    const {normalizeDesignDocument,serializeDesignDocument}=await import('/app/document.mjs');
    const r=await captureWorkspaceHtmlResult({html,sourcePath:'source.html',readText:async()=>'',rootSelector:'#fixture',viewportWidth:640,viewportHeight:240});
    const d=normalizeDesignDocument(r.document),text=d.nodes.find(n=>n.type==='text');
    return {warnings:r.report.warnings,fontFamilies:r.report.fontFamilies,text,
      reopened:normalizeDesignDocument(JSON.parse(serializeDesignDocument(d))).nodes.find(n=>n.type==='text')};
  },html);
  assert.equal(p.fontFamilies.restored,1);assert.equal(p.text.fontFamily,'Inter, system-ui');
  assert.equal(p.text.textSource,raw);assert.equal(p.reopened.textSource,raw);assert.equal(p.reopened.fontFamily,p.text.fontFamily);
  assert.equal(JSON.parse(p.text.textMetrics.sourceSignature)[1],p.text.fontFamily);
  assert(!p.warnings.some(w=>w.code==='html-font-family-unverified'));
});
