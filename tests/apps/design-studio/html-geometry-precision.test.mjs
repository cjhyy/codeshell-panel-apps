import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {resolve,sep} from "node:path";
import {chromium} from "playwright";
import {PNG} from "pngjs";
import {designNodeToV3} from "../../../apps/design-studio/app/design-node-adapter.mjs";
import {normalizeDesignDocument,serializeDesignDocument} from "../../../apps/design-studio/app/document.mjs";
import {renderDesignFrontendPage} from "../../../apps/design-studio/app/frontend-export.mjs";
import {applyAllAutoLayouts,distributeFillSizes} from "../../../apps/design-studio/app/layout.mjs";
import {setNodeTreePosition} from "../../../apps/design-studio/app/geometry.mjs";
import {gridTrackSizes} from "../../../apps/design-studio/app/grid.mjs";

const root=resolve(fileURLToPath(new URL("../../../apps/design-studio/app/",import.meta.url)));
const source=(height)=>({id:"upstream",name:"Measured geometry",tag:"div",nodeType:"container",bounds:{x:-86.78125,y:13.59,width:300.123456,height},opacity:0.123456,visible:true,positioning:{mode:"static"},background:{layers:[]},overflow:"visible",children:[],layout:{display:"flex",padding:{top:0.015625,right:1.123456,bottom:2.59375,left:3.59},flex:{direction:"row",wrap:"nowrap",alignItems:"stretch",justifyContent:"flex-start",gap:{row:0.015625,column:1.123456}},sizing:{minWidth:65.59,maxWidth:300.123456,minHeight:15.59375,maxHeight:65.59375,boxSizing:"border-box"}}});

test("HTML geometry retains finite precision, original ownership and bounds without changing opacity policy",async()=>{
 for(const height of [65.59375,65.59]){
  const tree=source(height),before=JSON.stringify(tree),owned=new Map();
  const result=await designNodeToV3(tree,{includeViewport:true,viewportWidth:640,viewportHeight:400,viewportRelation:{x:-10.015625,y:86.78125},onNode:(source,node)=>owned.set(source,node)});
  assert.equal(JSON.stringify(tree),before);assert.equal(owned.get(tree),result.document.pages[0].children[0].children[0]);
  const doc=normalizeDesignDocument(JSON.parse(serializeDesignDocument(normalizeDesignDocument(result.document)))),n=doc.nodes.find(n=>n.id==="html-0");
  assert.equal(n.x,-10.015625);assert.equal(n.y,86.78125);assert.equal(n.width,300.123456);assert.equal(n.height,height);
  assert.deepEqual([n.paddingTop,n.paddingRight,n.paddingBottom,n.paddingLeft,n.rowGap,n.columnGap],[0.015625,1.123456,2.59375,3.59,0.015625,1.123456]);
  assert.deepEqual([n.minWidth,n.maxWidth,n.minHeight,n.maxHeight],[65.59,300.123456,15.59375,65.59375]);
  assert.equal(n.opacity,0.12,"paint opacity keeps the previous two-decimal policy");
 }
 const invalid=source(Infinity);invalid.bounds.width=25000;const bounded=await designNodeToV3(invalid,{includeViewport:false});
 assert.equal(bounded.document.pages[0].children[0].width,20000);assert.equal(bounded.document.pages[0].children[0].height,1);
 assert(bounded.report.warnings.some(w=>w.code==="bounded-number"));
 const changed=source(65.59);changed.layout.flex.gap.row=7;changed.cssGeometry={"row-gap":{value:3.015625,projection:3.01562}};
 assert.equal((await designNodeToV3(changed,{includeViewport:false})).document.pages[0].children[0].rowGap,7,"postprocessing that changed a gap must retain its own geometry");
 const captured=source(65.59);captured.layout.flex.gap.row=3.01562;captured.cssGeometry={"row-gap":{value:3.015625,projection:3.01562}};const before=JSON.stringify(captured);
 assert.equal((await designNodeToV3(captured,{includeViewport:false})).document.pages[0].children[0].rowGap,3.015625);assert.equal(JSON.stringify(captured),before,"exact px capture is consumed without mutating its source record");
});

test("shared frontend preserves authored geometry decimals while paint serialization stays unchanged",async()=>{
 const adapted=await designNodeToV3(source(65.59),{includeViewport:false}),doc=normalizeDesignDocument(adapted.document),n=doc.nodes[0];
 Object.assign(n,{x:-86.78125,y:65.59,width:300.123456,height:65.59375,layout:"none",stroke:"#112233",strokeWidth:1.123456,cornerRadii:[1.123456,2.123456,3.123456,4.123456]});
 const html=renderDesignFrontendPage(doc);
 assert(html.includes("left:-86.78125px"));assert(html.includes("top:65.59px"));assert(html.includes("width:300.123456px"));assert(html.includes("height:65.59375px"));
 assert(html.includes("border-radius:1.123px 2.123px 3.123px 4.123px"));assert(html.includes("1.123px solid"));
 const reopened=normalizeDesignDocument(JSON.parse(serializeDesignDocument(doc)));
 assert.deepEqual([reopened.nodes[0].x,reopened.nodes[0].y,reopened.nodes[0].width,reopened.nodes[0].height],[-86.78125,65.59,300.123456,65.59375]);
});

test("Auto Layout keeps exact finite bounds, thirds, limits, wraps and descendant deltas while manual placement keeps its policy",()=>{
 for(const height of [65.59,65.59375]){
  const nodes=[{id:"row",type:"frame",x:-86.78125,y:13.59,width:400,height,layout:"horizontal",gap:0.015625,paddingLeft:3.59,paddingRight:1.123456,layoutSizingHorizontal:"fixed",layoutSizingVertical:"fixed"},
   ...Array.from({length:3},(_,i)=>({id:`child-${i}`,parentId:"row",type:"frame",x:0,y:0,width:1,height,layout:"none",layoutSizingHorizontal:"fill",layoutSizingVertical:"fixed"})),
   {id:"descendant",parentId:"child-1",type:"rectangle",x:0.015625,y:0.59,width:65.59,height:65.59375}];
  applyAllAutoLayouts(nodes);const share=(400-3.59-1.123456-2*0.015625)/3;
  assert.equal(nodes[1].width,share);assert.equal(nodes[2].x,-86.78125+3.59+share+0.015625);
  assert.equal(nodes[2].height,height);assert.equal(nodes[4].x,nodes[2].x+0.015625);
  const stable=JSON.stringify(nodes);assert.equal(applyAllAutoLayouts(nodes),false);assert.equal(JSON.stringify(nodes),stable);
  for(let i=0;i<8;i++)applyAllAutoLayouts(nodes);assert.equal(JSON.stringify(nodes),stable,"repeated reflow has no accumulated delta");
 }
 const fills=[{id:"a",type:"rectangle",minWidth:65.59,maxWidth:65.59},{id:"b",type:"rectangle",minWidth:65.59375,maxWidth:65.59375},{id:"c",type:"rectangle"}];
 assert.deepEqual([...distributeFillSizes(fills,"horizontal",400).values()],[65.59,65.59375,400-65.59-65.59375]);
 const wrap=[{id:"wrap",type:"frame",x:10.015625,y:-13.59,width:140,height:100,layout:"horizontal",layoutWrap:"wrap",alignContent:"start",alignItems:"start",gap:0.015625,rowGap:3.015625,columnGap:0.015625},
  ...[65.59,65.59375,65.59].map((width,i)=>({id:`w${i}`,parentId:"wrap",type:"rectangle",x:0,y:0,width,height:15.59375}))];
 applyAllAutoLayouts(wrap);assert.equal(wrap[3].x,10.015625);assert.equal(wrap[3].y,-13.59+15.59375+3.015625);
 const stable=JSON.stringify(wrap);assert.equal(applyAllAutoLayouts(wrap),false);assert.equal(JSON.stringify(wrap),stable);
 const manual=[{id:"manual",type:"frame",x:0,y:0,width:10,height:10},{id:"nested",parentId:"manual",type:"rectangle",x:1,y:1,width:1,height:1}];
 setNodeTreePosition(manual,"manual","x",65.59375);assert.equal(manual[0].x,65.59);assert.equal(manual[1].x,66.59);
});

test("Grid resolves flexible endpoints as Float32 while fixed/Hug authored tracks, roots and fixed Text inputs keep exact doubles",()=>{
 const tracks=[{type:"fixed",value:65.59},{type:"fixed",value:65.59375},{type:"flex",value:1}],before=JSON.stringify(tracks);
 const resolved=gridTrackSizes(tracks,3,[],"horizontal",3.015625,400.123456);
 assert.deepEqual(resolved,[65.59,65.59375,Math.fround(400.123456-65.59-65.59375-2*3.015625)]);
 assert.equal(JSON.stringify(tracks),before);
 const placements=[{column:0,columnSpan:1,child:{width:65.59}}];
 assert.deepEqual(gridTrackSizes([{type:"hug"}],1,placements,"horizontal",0,undefined),[65.59]);
 const nodes=[{id:"grid",type:"frame",x:-86.78125,y:-13.59,width:200,height:160,layout:"grid",gridColumns:2,gridColumnSizes:tracks.slice(0,2),gridRowSizes:[{type:"fixed",value:100}],columnGap:3.015625,rowGap:0},
  ...[65.59,65.59375].map((height,i)=>({id:`fixed-text-${i}`,parentId:"grid",type:"text",text:"A",x:0,y:0,width:10,height,layoutSizingHorizontal:"fill",layoutSizingVertical:"fixed"}))];
 applyAllAutoLayouts(nodes);assert.equal(nodes[0].y,-13.59);
 assert.deepEqual(nodes.slice(1).map(n=>[n.width,n.height]),[[65.59,65.59],[65.59375,65.59375]]);
 assert.equal(nodes[2].x,Math.fround(-86.78125+65.59+3.015625));
 const stable=JSON.stringify(nodes);assert.equal(applyAllAutoLayouts(nodes),false);assert.equal(JSON.stringify(nodes),stable);
});

async function browserFixture(t){
 const browser=await chromium.launch({headless:true,args:["--disable-gpu"]});t.after(()=>browser.close());
 const context=await browser.newContext({viewport:{width:640,height:600},deviceScaleFactor:1});
 await context.addInitScript(()=>{for(const prototype of [HTMLCanvasElement.prototype,globalThis.OffscreenCanvas?.prototype].filter(Boolean)){const original=prototype.getContext;prototype.getContext=function(kind,...args){if(/webgl|webgpu/iu.test(String(kind)))return null;return Reflect.apply(original,this,[kind,...args]);};}});
 await context.route("**/*",async route=>{const url=new URL(route.request().url());if(url.origin!=="https://precision.test")return route.abort();if(url.pathname==="/")return route.fulfill({body:"<!doctype html>",contentType:"text/html"});const path=resolve(root,"."+url.pathname);if(!path.startsWith(root+sep)||!path.endsWith(".mjs"))return route.abort();return route.fulfill({body:await readFile(path),contentType:"text/javascript"});});
 const page=await context.newPage();await page.goto("https://precision.test/");return{context,page};
}
const markup=`<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;background:white}#root{position:relative;left:10.015625px;top:86.78125px;width:400px;display:flex;flex-direction:column;padding:20px;gap:3.015625px;background:#eee;font:16px/1.6 Arial,sans-serif}.row{display:flex;gap:10px;padding:10px;background:#fef3c7}.item{flex:0 0 160px;padding:10px;background:#f59e0b;color:white}</style><main id="root">${Array.from({length:3},(_,i)=>`<section class="row" id="row-${i}"><div class="item">Editable ${i}</div><div class="item">Content</div></section>`).join("")}</main>`;

test("capture transports actual typed px values without interpreting percentage, mixed calc or unavailable Typed OM as pixels",async t=>{
 const f=await browserFixture(t);
 await f.page.setContent('<style>body{margin:0}#root{display:flex;flex-direction:column;width:400px;gap:3.015625px;padding:1.123456px;min-width:65.59px;max-width:400.123456px}#percent{width:50%;padding-left:5%;min-width:5%;display:flex;gap:10%}#calc{display:flex;padding-left:calc(1px + 5%);gap:calc(2px + 1%)}#literal{height:65.59px}</style><main id="root"><div id="percent">Percent</div><div id="calc">Mixed</div><div id="literal">Authored</div></main>');
 const values=await f.page.evaluate(async()=>{
  const {convertToDesignDSL}=await import("/vendor/html2figma-browser.mjs"),root=document.querySelector("#root");
  const capture=()=>{const tree=convertToDesignDSL(root),nodes=[];const visit=n=>{nodes.push(n);for(const c of n.children??[])visit(c);};visit(tree);return{tree,nodes};};
  const native=Object.fromEntries(["padding-left","min-width","max-width"].map(key=>[key,root.computedStyleMap().get(key).value]));const literalHeight=document.querySelector("#literal").computedStyleMap().get("height").value;
  const initial=capture();Object.defineProperty(root,"computedStyleMap",{value:undefined,configurable:true});const unavailable=capture();
  return{initial,unavailable,native,literalHeight};
 });
 const initial=values.initial.tree;
 assert.equal(initial.cssGeometry["row-gap"].value,3.015625);assert.equal(initial.cssGeometry["row-gap"].projection,3.01562);
 assert.equal(initial.cssGeometry["padding-left"].value,values.native["padding-left"]);assert.equal(initial.cssGeometry["min-width"].value,values.native["min-width"]);
 assert.equal(initial.cssGeometry["max-width"].value,values.native["max-width"]);assert.equal(initial.cssLayout["min-width"],`${values.native["min-width"]}px`);
 const byId=id=>values.initial.nodes.find(n=>n.nodeType!=="text"&&n.semantic?.attributes?.id===id);
 for(const id of ["percent","calc"]){const node=byId(id);assert(node);assert.equal(node.cssGeometry["padding-left"],undefined);assert.equal(node.cssGeometry["row-gap"],undefined);}
 assert.equal(byId("percent").cssGeometry["min-width"],undefined);
 assert.equal(byId("literal").cssGeometry.height.value,values.literalHeight);assert.equal(byId("literal").bounds.height,65.578125,"actual measured bounds remain distinct from authored CSS decimals");
 assert.deepEqual(values.unavailable.tree.cssGeometry,{});assert.equal(values.unavailable.tree.layout.flex.gap.row,3.01562);
 assert(values.initial.nodes.filter(n=>n.nodeType==="text").every(n=>n.cssGeometry===undefined));
});

test("content-box min/max constraints use the same exact captured per-side padding as the actual CSS box",async t=>{
 const f=await browserFixture(t),html='<style>html,body{margin:0;background:white}#root{box-sizing:content-box;display:flex;flex-direction:column;width:65.59px;min-width:65.59375px;max-width:100.59px;min-height:65.59px;max-height:100.59375px;padding:3.015625px;background:#fedcba}#child{height:15.59375px;background:#abcdef}</style><main id="root"><div id="child"></div></main>';
 const captured=await f.page.evaluate(async html=>{const {captureWorkspaceHtmlResult}=await import("/html-import.mjs");return captureWorkspaceHtmlResult({html,sourcePath:"content-box.html",readText:async()=>null,rootSelector:"#root",viewportWidth:640,viewportHeight:600,engine:"html2figma"});},html);
 await f.page.setContent(html);const measured=await f.page.evaluate(()=>{const e=document.querySelector("#root"),r=e.getBoundingClientRect(),style=e.computedStyleMap();return{geometry:[r.x,r.y,r.width,r.height],constraints:Object.fromEntries(["min-width","max-width","min-height","max-height"].map(key=>[key,style.get(key).value])),padding:["left","right","top","bottom"].map(side=>style.get(`padding-${side}`).value)};});
 const source=PNG.sync.read(await f.page.screenshot({caret:"initial",animations:"allow"}));
 const canonical=normalizeDesignDocument(captured.document),node=canonical.nodes.find(n=>n.name==="main#root"),inset=measured.padding[0]+measured.padding[1];
 assert.equal(node.minWidth,measured.constraints["min-width"]+inset);assert.equal(node.maxWidth,measured.constraints["max-width"]+inset);
 assert.equal(node.minHeight,measured.constraints["min-height"]+inset);assert.equal(node.maxHeight,measured.constraints["max-height"]+inset);
 assert.deepEqual([node.paddingLeft,node.paddingRight,node.paddingTop,node.paddingBottom],measured.padding);
 const page=await f.context.newPage();await page.goto("https://precision.test/");const geometry=await page.evaluate(async value=>{const {createBrowserRenderer}=await import("/canvas/browser-renderer.mjs"),{normalizeDesignDocument,serializeDesignDocument}=await import("/document.mjs");document.body.style.margin="0";const container=document.createElement("div");container.style.cssText="position:absolute;inset:0";document.body.append(container);window.renderer=createBrowserRenderer({container});const design=normalizeDesignDocument(JSON.parse(serializeDesignDocument(normalizeDesignDocument(value))));await renderer.setScene(design,{resources:new Map()});renderer.resize(640,600,1);renderer.render({pan:{x:0,y:0},zoom:1});return[...renderer.geometry()];},captured.document);
 const converted=PNG.sync.read(await page.screenshot({caret:"initial",animations:"allow"})),actual=new Map(geometry).get(node.id);
 assert.deepEqual([actual.x,actual.y,actual.width,actual.height],measured.geometry);
 assert.deepEqual(converted.data,source.data,"actual CSS content-box constraint and reopened canonical Browser pixels");await page.evaluate(()=>renderer.dispose());
});

for(const childHug of [false,true]) test(`stock CSS capture and real Browser retain fractional Auto Layout ${childHug ? "child Hug growth" : "same-line edit"} through save/reopen`,async t=>{
 const sourceMarkup=childHug ? markup.replace(".row{display:flex;", ".row{align-items:flex-start;display:flex;") : markup;
 const f=await browserFixture(t);
 const captured=await f.page.evaluate(async html=>{const {captureWorkspaceHtmlResult}=await import("/html-import.mjs");return captureWorkspaceHtmlResult({html,sourcePath:"precision.html",readText:async()=>null,rootSelector:"#root",viewportWidth:640,viewportHeight:600,engine:"html2figma"});},sourceMarkup);
 await f.page.setContent(sourceMarkup);await f.page.evaluate(()=>document.fonts.ready);const sourceGeometry=await f.page.evaluate(()=>[...document.querySelectorAll("#root,.row")].map(e=>{const r=e.getBoundingClientRect();const typed=e.computedStyleMap().get("row-gap");return{id:e.id,x:r.x,y:r.y,width:r.width,height:r.height,rowGap:getComputedStyle(e).rowGap,typedRowGap:{unit:typed.unit,value:typed.value,text:typed.toString()}};}));
 const sourcePNG=PNG.sync.read(await f.page.screenshot({caret:"initial",animations:"allow"}));
 const page=await f.context.newPage();await page.goto("https://precision.test/");
 const observed=await page.evaluate(async value=>{const {normalizeDesignDocument,serializeDesignDocument}=await import("/document.mjs"),{createBrowserRenderer}=await import("/canvas/browser-renderer.mjs");const design=normalizeDesignDocument(JSON.parse(serializeDesignDocument(normalizeDesignDocument(value)))),container=document.createElement("div");document.body.style.cssText="margin:0;background:white";container.style.cssText="position:absolute;inset:0";document.body.append(container);window.precisionRenderer=createBrowserRenderer({container});await precisionRenderer.setScene(design,{resources:new Map()});precisionRenderer.resize(640,600,1);precisionRenderer.render({pan:{x:0,y:0},zoom:1});const all=[...precisionRenderer.geometry()];const {applyAllAutoLayouts}=await import("/layout.mjs");const relayout=normalizeDesignDocument(JSON.parse(serializeDesignDocument(design))),beforeLayout=JSON.stringify(relayout.nodes);applyAllAutoLayouts(relayout.nodes);return{nodes:design.nodes,geometry:all,relayout:{changed:beforeLayout!==JSON.stringify(relayout.nodes),nodes:relayout.nodes}};},captured.document);
 const converted=PNG.sync.read(await page.screenshot({caret:"initial",animations:"allow"}));let different=0;for(let i=0;i<sourcePNG.data.length;i+=4)if([0,1,2,3].some(c=>sourcePNG.data[i+c]!==converted.data[i+c]))different++;
 if(process.env.CODESHELL_GEOMETRY_EVIDENCE_DIR){const out=resolve(process.env.CODESHELL_GEOMETRY_EVIDENCE_DIR,childHug ? "child-hug" : "same-line");await mkdir(out,{recursive:true});await writeFile(resolve(out,"early-control.json"),JSON.stringify({sourceGeometry,captured,observed,different,scope:"Actual stock capture and independent CSS source/Browser CPU; noGL. Current failed control retained."},null,2)+"\n");await writeFile(resolve(out,"source.png"),PNG.sync.write(sourcePNG));await writeFile(resolve(out,"Browser.png"),PNG.sync.write(converted));}
 const geometry=new Map(observed.geometry);
 for(const s of sourceGeometry){const n=observed.nodes.find(n=>{try{return JSON.parse(n.notes).attributes?.id===s.id;}catch{return false;}});assert(n);assert.notEqual(n.layout,"none");const g=geometry.get(n.id);assert.deepEqual([g.x,g.y,g.width,g.height],[s.x,s.y,s.width,s.height],s.id);}
 assert.equal(different,0,"same actual CSS source and unmodified canonical render must preserve every initial RGBA pixel");
 const editedText=childHug ? "Editable detail continues across several words" : "Edited 0";
 await f.page.locator("#row-0 .item").first().evaluate((element,text)=>{element.textContent=text;},editedText);
 const editedSourceGeometry=await f.page.evaluate(()=>[...document.querySelectorAll("#root,.row")].map(e=>{const r=e.getBoundingClientRect();return{id:e.id,x:r.x,y:r.y,width:r.width,height:r.height};}));
 const editedSource=PNG.sync.read(await f.page.screenshot({caret:"initial",animations:"allow"}));
 const edited=await page.evaluate(async ({value,text})=>{
  const {normalizeDesignDocument,serializeDesignDocument}=await import("/document.mjs"),{replaceTextValue}=await import("/text-ranges.mjs"),{applyAllAutoLayouts}=await import("/layout.mjs");
  const design=normalizeDesignDocument(value),index=design.nodes.findIndex(n=>n.type==="text"&&n.text==="Editable 0");
  design.nodes[index]=replaceTextValue(design.nodes[index],text);applyAllAutoLayouts(design.nodes);
  const before=JSON.stringify(design.nodes),again=applyAllAutoLayouts(design.nodes),stable=before===JSON.stringify(design.nodes);
  const reopened=normalizeDesignDocument(JSON.parse(serializeDesignDocument(design)));
  await precisionRenderer.setScene(reopened,{resources:new Map()});precisionRenderer.render({pan:{x:0,y:0},zoom:1});
  return{nodes:reopened.nodes,geometry:[...precisionRenderer.geometry()],again,stable};
 },{value:captured.document,text:editedText});
 const editedBrowser=PNG.sync.read(await page.screenshot({caret:"initial",animations:"allow"}));let editedDifferent=0;for(let i=0;i<editedSource.data.length;i+=4)if([0,1,2,3].some(c=>editedSource.data[i+c]!==editedBrowser.data[i+c]))editedDifferent++;
 if(process.env.CODESHELL_GEOMETRY_EVIDENCE_DIR){const out=resolve(process.env.CODESHELL_GEOMETRY_EVIDENCE_DIR,childHug ? "child-hug" : "same-line");await writeFile(resolve(out,"edited-control.json"),JSON.stringify({editedText,editedSourceGeometry,edited,editedDifferent,scope:"Actual source content edit versus canonical source-indexed text edit, real Auto Layout and save/reopen; CPU noGL."},null,2)+"\n");await writeFile(resolve(out,"edited-source.png"),PNG.sync.write(editedSource));await writeFile(resolve(out,"edited-Browser.png"),PNG.sync.write(editedBrowser));}
 assert.equal(edited.stable,true,"actual content edit reaches an exact Auto Layout fixed point");
 const editedGeometry=new Map(edited.geometry);
 for(const s of editedSourceGeometry){const n=edited.nodes.find(n=>{try{return JSON.parse(n.notes).attributes?.id===s.id;}catch{return false;}});assert(n);assert.notEqual(n.layout,"none");const g=editedGeometry.get(n.id);assert.deepEqual([g.x,g.y,g.width,g.height],[s.x,s.y,s.width,s.height],`edited ${s.id}`);}
 assert.equal(editedDifferent,0,"actual content edit remains source pixel exact after genuine Auto Layout and reopen");
 await page.evaluate(()=>precisionRenderer.dispose());
});
