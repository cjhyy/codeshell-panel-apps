import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, sep, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { normalizeDesignDocument, exportDesignSvg } from "../../../apps/design-studio/app/document.mjs";

const app = resolve(fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url)));
const evidence = process.env.CODESHELL_BROWSER_RENDERER_EVIDENCE_DIR;
function pixelDiff(source, converted) {
 const a=PNG.sync.read(source),b=PNG.sync.read(converted);assert.deepEqual([a.width,a.height],[b.width,b.height]);const diff=new PNG({width:a.width,height:a.height});let differentPixels=0,maxDelta=0;
 for(let i=0;i<a.data.length;i+=4){let different=false;for(let j=0;j<4;j++){const delta=Math.abs(a.data[i+j]-b.data[i+j]);maxDelta=Math.max(maxDelta,delta);different||=delta!==0;}differentPixels+=Number(different);diff.data.set(different?[255,0,0,255]:[255,255,255,255],i);}
 return{differentPixels,maxDelta,png:PNG.sync.write(diff)};
}
const base = (id,type,x,y,width,height,extra={}) => ({id,name:id,type,x,y,width,height,fill:"#1768a5",stroke:"transparent",strokeWidth:0,opacity:1,visible:true,locked:false,rotation:0,cornerRadius:0,layoutSizingHorizontal:"fixed",layoutSizingVertical:"fixed",...(["frame","component","group"].includes(type)?{layout:"none",gap:0,padding:0,alignItems:"start",justifyContent:"start"}:{}),...extra});
const copy = "Before the application deadline please view your application and keep the confirmation.";
function documentOf(children) {
 return normalizeDesignDocument({format:"codeshell.design",version:3,name:"Browser authority",canvas:{width:800,height:500,background:"#ffffff"},tokens:{colors:[]},resources:[],activePageId:"page",pages:[{id:"page",name:"Page",children}]});
}
const paragraph = (id,x,y,width,height,extra={}) => base(id,"text",x,y,width,height,{fill:"#111111",text:copy,textSource:copy,fontFamily:"Arial, sans-serif",fontSize:20,fontWeight:400,fontStyle:"normal",letterSpacing:0,lineHeight:1.5,textAlign:"left",textDecoration:"none",textFlow:"wrap",...extra});
function poisoned() { return documentOf([base("root","frame",20,20,600,9999,{fill:"#f0f0f0",layout:"vertical",layoutSizingVertical:"hug",padding:20,gap:12,children:[paragraph("text",9000,9000,9999,9999,{layoutSizingHorizontal:"fill",layoutSizingVertical:"hug"}),base("box","rectangle",1234,1234,80,40),base("abs","rectangle",500,30,20,20,{layoutPositioning:"absolute",fill:"#e45522"})]})]); }
async function fixture(t) {
 const browser=await chromium.launch({args:["--disable-gpu"]});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:800,height:500},deviceScaleFactor:1}),errors=[],requests=[];
 page.on("pageerror",error=>errors.push(error.message));
 await page.route("**/*",async route=>{const url=new URL(route.request().url());requests.push(url.pathname);if(url.origin!=="https://browser-renderer.test")throw Error("Unexpected external request");if(url.pathname==="/")return route.fulfill({body:'<!doctype html><style>body{margin:0}#surface{position:absolute;inset:0}#overlay{position:absolute;inset:0;width:800px;height:500px}</style><div id="surface"></div><canvas id="overlay"></canvas>',contentType:"text/html"});const file=resolve(app,"."+url.pathname);assert(file.startsWith(app+sep));return route.fulfill({body:await readFile(file),contentType:{".mjs":"text/javascript",".js":"text/javascript",".woff2":"font/woff2",".ttf":"font/ttf"}[extname(file)]});});
 await page.goto("https://browser-renderer.test/");
 await page.evaluate(async()=>{const {createBrowserRenderer}=await import("/canvas/browser-renderer.mjs");window.createBrowserRenderer=createBrowserRenderer;window.renderer=createBrowserRenderer({container:document.querySelector("#surface")});});
 t.after(()=>assert.deepEqual(errors,[]));
 return {page,requests};
}

test("browser CSS owns canonical AL geometry despite poisoned derived coordinates, Hug sizes and Fill width",async t=>{
 const {page,requests}=await fixture(t),design=poisoned(),raw=JSON.stringify(design);
 const result=await page.evaluate(async design=>{const raw=JSON.stringify(design);await renderer.setScene(design);renderer.resize(800,500);renderer.render();const initial=[...renderer.geometry()],hit=renderer.hitTest({x:50,y:50});renderer.render({pan:{x:17,y:23},zoom:1.5});return{initial,hit,transformedHit:renderer.hitTest({x:50,y:50}),stats:renderer.stats(),unchanged:JSON.stringify(design)===raw};},design);
 const geometry=new Map(result.initial);
 assert.deepEqual([geometry.get("root").x,geometry.get("root").y,geometry.get("root").width,geometry.get("root").height],[20,20,600,152]);
 assert.deepEqual([geometry.get("text").x,geometry.get("text").y,geometry.get("text").width,geometry.get("text").height],[40,40,560,60]);
 assert.deepEqual([geometry.get("box").x,geometry.get("box").y,geometry.get("box").width,geometry.get("box").height],[40,112,80,40]);
 assert.deepEqual([geometry.get("abs").x,geometry.get("abs").y],[500,30]);
 assert.equal(geometry.get("root").display,"flex");assert.equal(geometry.get("text").position,"relative");assert.equal(geometry.get("box").position,"relative");assert.equal(geometry.get("abs").position,"absolute");assert.equal(result.hit,"text");assert.equal(result.transformedHit,"text");assert.equal(JSON.stringify(design),raw);assert(!requests.some(path=>path.includes("canvaskit")||path.endsWith(".wasm")));
 const updated=structuredClone(design);updated.nodes.find(node=>node.id==="text").text=updated.nodes.find(node=>node.id==="text").textSource=copy+" "+copy;
 const edited=await page.evaluate(async design=>{await renderer.setScene(design);return [...renderer.geometry()];},updated);
 assert(new Map(edited).get("text").height>60);assert(new Map(edited).get("root").height>152);
 const narrowed=structuredClone(design);narrowed.nodes.find(node=>node.id==="root").width=400;
 const narrow=await page.evaluate(async design=>{await renderer.setScene(design);return [...renderer.geometry()];},narrowed);assert.equal(new Map(narrow).get("text").width,360);assert.equal(new Map(narrow).get("text").height,90);
 await page.evaluate(()=>{const leaked=renderer.geometry();leaked.get("text").width=1;leaked.get("text").matrix[4]=9999;});
 assert.equal(await page.evaluate(()=>renderer.geometry().get("text").width),360);
 if(evidence){await mkdir(evidence,{recursive:true});await page.screenshot({path:join(evidence,"canonical-poison-narrow.png")});await writeFile(join(evidence,"canonical-poison.json"),JSON.stringify({cpuOnly:true,launchArgs:["--disable-gpu"],initial:result,edited,narrow,sourceUnchanged:JSON.stringify(design)===raw},null,2)+"\n");}
});

test("browser fixed overflow, min/max, Grid, clipping and rotated hits use actual DOM layout",async t=>{
 const {page}=await fixture(t);
 const design=documentOf([
  base("row","frame",20,20,240,40,{layout:"horizontal",padding:10,gap:10,children:[base("fixed-a","rectangle",9000,9000,180,20),base("fixed-b","rectangle",9000,9000,100,20)]}),
  base("grid","frame",20,100,400,9999,{layout:"grid",layoutSizingVertical:"hug",gridColumns:2,gridRows:1,gridColumnSizes:[{type:"fixed",value:100},{type:"flex",value:1}],gridRowSizes:[{type:"hug"}],columnGap:10,rowGap:0,children:[paragraph("grid-a",9000,9000,9999,9999,{text:"short",textSource:"short",layoutSizingHorizontal:"fill",layoutSizingVertical:"hug"}),paragraph("grid-b",9000,9000,9999,9999,{layoutSizingHorizontal:"fill",layoutSizingVertical:"hug",maxWidth:200})]}),
  base("clip","frame",500,20,100,100,{fill:"#dddddd",clipContent:true,cornerRadius:40,children:[base("clipped","rectangle",490,10,140,140)]}),
  base("rotated","rectangle",650,40,100,20,{rotation:90}),
 ]);
 const result=await page.evaluate(async design=>{await renderer.setScene(design);renderer.resize(800,500);renderer.render({pan:{x:0,y:0},zoom:1});return{geometry:[...renderer.geometry()],corner:renderer.hitTest({x:501,y:21}),inside:renderer.hitTest({x:550,y:70}),rotatedInside:renderer.hitTest({x:700,y:50}),rotatedOutside:renderer.hitTest({x:660,y:50})};},design),g=new Map(result.geometry);
 assert.equal(g.get("fixed-a").width,180);assert.equal(g.get("fixed-b").width,100);assert.equal(g.get("grid").display,"grid");assert.equal(g.get("grid-a").width,100);assert.equal(g.get("grid-b").width,200);assert(g.get("grid").height<9999);assert.equal(result.corner,null);assert.equal(result.inside,"clipped");assert.equal(result.rotatedInside,"rotated");assert.equal(result.rotatedOutside,null);assert.equal(Math.round(g.get("rotated").width),20);assert.equal(Math.round(g.get("rotated").height),100);
});

test("browser lifecycle preserves canonical data and owns fonts/staging across supersession, errors and surface recreation",async t=>{
 const {page}=await fixture(t),design=poisoned();
 const rows=await page.evaluate(async design=>{
  const bytes=new Uint8Array(await(await fetch("/fonts/InterVariable.woff2")).arrayBuffer()),digest=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(n=>n.toString(16).padStart(2,"0")).join("");
  const descriptor={id:"font",kind:"font",mime:"font/woff2",bytes:bytes.length,sha256:digest,partCount:1,family:"Case, Family",weight:400,style:"normal"};
  const withFont=structuredClone(design);withFont.resources=[descriptor];const text=withFont.nodes.find(n=>n.id==="text");text.fontRef="font";text.fontFamily='"Case, Family", Arial, sans-serif';
  const resources=new Map([["font",{descriptor,bytes,mimeType:"font/woff2"}]]),raw=JSON.stringify(withFont),baseline=document.fonts.size;
  await renderer.setScene(withFont,{resources});const fontGeometry=renderer.geometry().get("text"),fontCount=document.fonts.size;
  const originalLoad=FontFace.prototype.load;let release,started;const waiting=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
  FontFace.prototype.load=async function(){const loaded=await originalLoad.call(this);started();await gate;return loaded;};
  const stale=renderer.setScene(withFont,{resources});await waiting;const replacement=structuredClone(design);replacement.nodes.find(n=>n.id==="root").width=400;await renderer.setScene(replacement);release();const superseded=await stale;FontFace.prototype.load=originalLoad;
  const after=renderer.geometry().get("text"),afterFaces=document.fonts.size;
  let unsafeRefused=false;const svg=new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">unsafe</div></foreignObject></svg>');
  const svgDigest=[...new Uint8Array(await crypto.subtle.digest("SHA-256",svg))].map(n=>n.toString(16).padStart(2,"0")).join("");
  const svgDescriptor={id:"image",kind:"image",mime:"image/svg+xml",bytes:svg.length,sha256:svgDigest,partCount:1},svgDesign={...design,resources:[svgDescriptor]};
  try{await renderer.setScene(svgDesign,{resources:new Map([["image",{descriptor:svgDescriptor,bytes:svg,mimeType:"image/svg+xml"}]])});}catch(error){unsafeRefused=/SVG|foreignObject/iu.test(error.message);}
  const retained=renderer.geometry().get("text").width===360;
  renderer.dispose();const emptied=document.fonts.size===baseline;renderer=createBrowserRenderer({container:document.querySelector("#surface")});await renderer.setScene(design);renderer.resize(800,500);renderer.render();
  return{rawUnchanged:raw===JSON.stringify(withFont),fontGeometry,fontCount,baseline,superseded,after,afterFaces,unsafeRefused,retained,emptied,recreated:renderer.geometry().get("text").width===560};
 },design);
 assert(rows.rawUnchanged&&rows.unsafeRefused&&rows.retained&&rows.emptied&&rows.recreated);assert.equal(rows.fontCount,rows.baseline+2);assert.equal(rows.superseded,false);assert.equal(rows.after.width,360);assert.equal(rows.afterFaces,rows.baseline);
});

test("canonical 120-unit font stacks retain multiple supplied aliases, quoted names and ordered fallbacks without reparsing runtime CSS",async t=>{
 const {page}=await fixture(t),design=poisoned();
 const result=await page.evaluate(async design=>{
  const {renderDesignFrontendPage}=await import("/frontend-export.mjs"),{createDesignRuntimeFontFamily,designRuntimeFontFamilyCss}=await import("/font-css.mjs");
  const names=["A","B","C","D","E","F","G","H"],before=names.join(",")+",",after=",Arial,sans-serif",family=before+'"'+"Q".repeat(120-before.length-after.length-2)+'"'+after;
  const inter=new Uint8Array(await(await fetch("/fonts/InterVariable.woff2")).arrayBuffer()),icons=new Uint8Array(await(await fetch("/fonts/fa-solid-900.woff2")).arrayBuffer());
  const resources=new Map();design.resources=[];
  for(let i=0;i<names.length;i++){const bytes=i===0?icons:inter,digest=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(n=>n.toString(16).padStart(2,"0")).join(""),descriptor={id:"font-"+i,kind:"font",mime:"font/woff2",bytes:bytes.length,sha256:digest,partCount:1,family:names[i],weight:i===0?900:400,style:"normal"};design.resources.push(descriptor);resources.set(descriptor.id,{descriptor,bytes,mimeType:"font/woff2"});}
  const text=design.nodes.find(node=>node.id==="text");text.fontFamily=family;text.fontRef="font-0";text.fontWeight=900;text.text=text.textSource=text.textSource+" éèàçùñïôö";
  const componentText={...structuredClone(text),id:"component-text",name:"component-text",parentId:"master"};
  const master={id:"master",name:"master",type:"component",x:0,y:0,width:560,height:90,fill:"#fafafa",stroke:"transparent",strokeWidth:0,opacity:1,rotation:0,cornerRadius:0,visible:true,locked:false,layout:"vertical",padding:0,gap:0,alignItems:"start",justifyContent:"start",layoutSizingHorizontal:"fixed",layoutSizingVertical:"fixed"};
  design.pages.push({id:"library",name:"Library",nodes:[master,componentText]});
  design.nodes.push({id:"instance",name:"instance",type:"instance",componentId:"master",x:20,y:250,width:560,height:90,fill:"transparent",stroke:"transparent",strokeWidth:0,opacity:1,rotation:0,cornerRadius:0,visible:true,locked:false,layoutSizingHorizontal:"fixed",layoutSizingVertical:"fixed"});design.pages[0].nodes=design.nodes;
  const raw=JSON.stringify(design);
  await renderer.setScene(design,{resources});renderer.resize(800,500);renderer.render({pan:{x:0,y:0},zoom:1});const first=renderer.geometry().get("text");
  window.fontStackSource=await new Promise(resolve=>requestAnimationFrame(()=>resolve(null)));
  const token=createDesignRuntimeFontFamily(family,{aliases:names.map((name,i)=>({name,alias:"long-private-runtime-alias-"+i}))}),runtime=designRuntimeFontFamilyCss(token);
  let unbrandedRefused=false;try{renderDesignFrontendPage(design,{fontFamilyOverrides:new Map([[text.id,"body{display:none}"]])});}catch{unbrandedRefused=true;}
  window.longFontScene={design,resources,raw,first,family};
  return{family,sourceLength:family.length,runtimeLength:runtime.length,runtime,first,unbrandedRefused,unchanged:raw===JSON.stringify(design)};
 },design);
 assert.equal(result.sourceLength,120);assert(result.runtimeLength>120);assert(result.first.fontFamily.length>120);assert(result.unbrandedRefused&&result.unchanged);
 const source=await page.screenshot();
 const control=await page.evaluate(async()=>{
  const {design,resources,family}=window.longFontScene,{renderDesignFrontendPage,designFrontendCss}=await import("/frontend-export.mjs");
  const literalFaces=[];for(const [id,{descriptor,bytes}]of resources){const face=new FontFace(descriptor.family,bytes,{weight:String(descriptor.weight),style:descriptor.style});await face.load();document.fonts.add(face);literalFaces.push(face);}
  const reference=document.createElement("div");reference.id="literal-reference";reference.style.cssText="position:absolute;left:0;top:0;width:800px;height:500px";
  const style=document.createElement("style");style.textContent=designFrontendCss({...design,resources:[]})+".cs-page{margin:0!important;overflow:visible!important}";reference.append(style);
  const markup=document.createElement("div");markup.innerHTML=renderDesignFrontendPage(design);reference.append(markup);document.body.append(reference);document.querySelector("#surface").style.visibility="hidden";
  reference.getBoundingClientRect();await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(resolve));
  const element=reference.querySelector('[data-codeshell-id="text"]'),rect=element.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(element);
  window.literalReference={reference,literalFaces};return{width:rect.width,height:rect.height,fontFamily:getComputedStyle(element).fontFamily,lineRects:[...range.getClientRects()].map(rect=>({x:rect.x,y:rect.y,width:rect.width,height:rect.height})),loaded:document.fonts.check('400 20px "B"',"é"),literalFamily:family};
 });
 const actual=await page.screenshot();
 const {differentPixels,maxDelta,png}=pixelDiff(source,actual);
 if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,"long-font-source.png"),source);await writeFile(join(evidence,"long-font-control.png"),actual);await writeFile(join(evidence,"long-font-diff.png"),png);await writeFile(join(evidence,"long-font-initial.json"),JSON.stringify({cpuOnly:true,result,control,differentPixels,maxDelta},null,2)+"\n");}
 await page.evaluate(()=>{literalReference.reference.remove();for(const face of literalReference.literalFaces)document.fonts.delete(face);document.querySelector("#surface").style.visibility="";});
 assert.equal(differentPixels,0,"private aliases must match the same actual bytes registered under literal source family names");
 assert.equal(control.height,result.first.height);assert.equal(control.width,result.first.width);assert(control.loaded);
 const narrow=await page.evaluate(async()=>{const {design,resources,raw}=window.longFontScene;const restored=JSON.parse(raw);restored.nodes.find(node=>node.id==="root").width=400;await renderer.setScene(restored,{resources});return{font:renderer.geometry().get("text").fontFamily,geometry:renderer.geometry().get("text"),sourceUnchanged:raw===JSON.stringify(design)};});
 assert(narrow.font.length>120&&narrow.sourceUnchanged);assert.equal(narrow.geometry.width,360);assert(narrow.geometry.height>result.first.height);
 if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,"long-font-source.png"),source);await writeFile(join(evidence,"long-font-control.png"),actual);await writeFile(join(evidence,"long-font.json"),JSON.stringify({cpuOnly:true,result,control,narrow},null,2)+"\n");}
});

test("owned image decoding precedes intrinsic Hug/aspect geometry and errors/supersession never publish a broken scene",async t=>{
 const {page}=await fixture(t);
 const result=await page.evaluate(async()=>{
  const canvas=document.createElement("canvas");canvas.width=80;canvas.height=40;canvas.getContext("2d").fillRect(0,0,80,40);
  const bytes=new Uint8Array(await(await fetch(canvas.toDataURL("image/png"))).arrayBuffer()),digest=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(n=>n.toString(16).padStart(2,"0")).join("");
  const descriptor={id:"image",kind:"image",mime:"image/png",bytes:bytes.length,sha256:digest,partCount:1},resources=new Map([["image",{descriptor,bytes,mimeType:"image/png"}]]);
  const image={id:"image-node",name:"image",type:"image",x:9000,y:9000,width:9999,height:9999,fill:"transparent",stroke:"transparent",strokeWidth:0,opacity:1,rotation:0,visible:true,locked:false,cornerRadius:0,imageRef:"image",objectFit:"contain",layoutSizingHorizontal:"hug",layoutSizingVertical:"hug",parentId:"root"};
  const root={id:"root",name:"root",type:"frame",x:20,y:20,width:200,height:9999,fill:"#eeeeee",stroke:"transparent",strokeWidth:0,opacity:1,rotation:0,visible:true,locked:false,cornerRadius:0,layout:"vertical",padding:10,gap:0,alignItems:"start",justifyContent:"start",layoutSizingHorizontal:"fixed",layoutSizingVertical:"hug"},nodes=[root,image],design={format:"codeshell.design",version:3,name:"Images",canvas:{width:800,height:500,background:"#ffffff"},resources:[descriptor],activePageId:"page",pages:[{id:"page",name:"Page",nodes}],nodes};
  await renderer.setScene(design,{resources});renderer.resize(800,500);renderer.render();const intrinsic=renderer.geometry().get("image-node"),hugRoot=renderer.geometry().get("root");
  const fill=structuredClone(design);fill.nodes.find(n=>n.id==="image-node").layoutSizingHorizontal="fill";await renderer.setScene(fill,{resources});const aspect=renderer.geometry().get("image-node");
  const decode=HTMLImageElement.prototype.decode;let start,release;const started=new Promise(resolve=>start=resolve),gate=new Promise(resolve=>release=resolve);
  HTMLImageElement.prototype.decode=async function(){await decode.call(this);start();await gate;};const pending=renderer.setScene(design,{resources});await started;
  const replacement=structuredClone(design);replacement.nodes=[];replacement.pages[0].nodes=[];await renderer.setScene(replacement,{resources});release();const superseded=await pending;HTMLImageElement.prototype.decode=decode;
  const badBytes=new Uint8Array([1,2,3,4]),badDigest=[...new Uint8Array(await crypto.subtle.digest("SHA-256",badBytes))].map(n=>n.toString(16).padStart(2,"0")).join("");const badDescriptor={...descriptor,bytes:badBytes.length,sha256:badDigest},badDesign={...design,resources:[badDescriptor]};
  let corruptRefused=false;try{await renderer.setScene(badDesign,{resources:new Map([["image",{descriptor:badDescriptor,bytes:badBytes,mimeType:"image/png"}]])});}catch(error){corruptRefused=error.message.includes("image decoding failed");}
  return{intrinsic,hugRoot,aspect,superseded,corruptRefused,currentNodes:renderer.geometry().size};
 });
 assert.deepEqual([result.intrinsic.width,result.intrinsic.height],[80,40]);assert.equal(result.hugRoot.height,60);assert.deepEqual([result.aspect.width,result.aspect.height],[180,90]);assert.equal(result.superseded,false);assert(result.corruptRefused);assert.equal(result.currentNodes,0);
});

test("browser owns source/resource snapshots and refuses stale digest, missing fallback and changed descriptors",async t=>{
 const {page}=await fixture(t),design=poisoned();
 const result=await page.evaluate(async design=>{
  const bytes=new Uint8Array(await(await fetch("/fonts/InterVariable.woff2")).arrayBuffer());
  const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(n=>n.toString(16).padStart(2,"0")).join("");
  const descriptor={id:"font",kind:"font",mime:"font/woff2",bytes:bytes.length,sha256:await sha(bytes),partCount:1,family:"Owned, Font",weight:400,style:"normal"};
  design.resources=[descriptor];const text=design.nodes.find(node=>node.id==="text");text.fontRef="font";text.fontFamily='"Owned, Font", Arial, sans-serif';const raw=JSON.stringify(design),resources=new Map([["font",{descriptor,bytes,mimeType:"font/woff2"}]]);
  const pending=renderer.setScene(design,{resources});bytes.fill(0);descriptor.family="Changed after request";text.fontFamily="monospace";const owned=await pending,first=renderer.geometry().get("text");
  const source=JSON.parse(raw),original=source.resources[0];let digestRefused=false,missingRefused=false,metadataRefused=false;
  try{await renderer.setScene(source,{resources:new Map([["font",{descriptor:original,bytes,mimeType:"font/woff2"}]])});}catch(error){digestRefused=error.message.includes("SHA-256");}
  try{await renderer.setScene(source);}catch(error){missingRefused=error.message.includes("Missing supplied named fallback");}
  try{await renderer.setScene(source,{resources:new Map([["font",{descriptor:{...original,family:"Other"},bytes,mimeType:"font/woff2"}]])});}catch(error){metadataRefused=error.message.includes("exact canonical descriptor");}
  const retained=JSON.stringify(renderer.geometry().get("text"))===JSON.stringify(first);
  const replacementBytes=new Uint8Array(await(await fetch("/fonts/fa-solid-900.woff2")).arrayBuffer()),replacement=structuredClone(source);replacement.resources[0]={...original,bytes:replacementBytes.length,sha256:await sha(replacementBytes)};
  await renderer.setScene(replacement,{resources:new Map([["font",{descriptor:replacement.resources[0],bytes:replacementBytes,mimeType:"font/woff2"}]])});
  const changed=renderer.geometry().get("text");return{owned,first,digestRefused,missingRefused,metadataRefused,retained,changed,changedContentDigest:replacement.resources[0].sha256!==original.sha256};
 },design);
 assert(result.owned&&result.digestRefused&&result.missingRefused&&result.metadataRefused&&result.retained&&result.changedContentDigest);
 assert.notEqual(result.first.fontFamily,result.changed.fontFamily);assert.notEqual(result.first.height,result.changed.height);
 if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,"asset-ownership.json"),JSON.stringify({cpuOnly:true,launchArgs:["--disable-gpu"],result},null,2)+"\n");}
});

test("hidden Hug nodes and descendants retain IDs without unresolved visible boxes, then toggle through fresh layout",async t=>{
 const {page}=await fixture(t),design=documentOf([
  base("hidden-parent","frame",20,20,9999,9999,{layout:"vertical",padding:10,gap:0,visible:false,layoutSizingHorizontal:"hug",layoutSizingVertical:"hug",children:[paragraph("hidden-child",9000,9000,9999,9999,{text:"Hidden hug",textSource:"Hidden hug",layoutSizingHorizontal:"hug",layoutSizingVertical:"hug"})]}),
  paragraph("hidden-own",20,180,9999,9999,{visible:false,layoutSizingHorizontal:"hug",layoutSizingVertical:"hug"}),
 ]);
 const initial=await page.evaluate(async design=>{
  const control=document.createElement("div");control.style.cssText="display:none;width:fit-content;height:fit-content";const child=document.createElement("div");child.style.cssText="width:fit-content;height:fit-content";child.textContent="Hidden hug";control.append(child);document.body.append(control);const raw=[control,child].map(element=>({display:getComputedStyle(element).display,width:getComputedStyle(element).width,height:getComputedStyle(element).height,box:{width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height}}));control.remove();
  let error=null;try{await renderer.setScene(design);renderer.resize(800,500);renderer.render();}catch(cause){error=cause.message;}return{raw,error,geometry:[...renderer.geometry()]};
 },design);
 if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,"hidden-hug-initial.json"),JSON.stringify({cpuOnly:true,initial},null,2)+"\n");}
 assert.equal(initial.error,null);
 const hidden=new Map(initial.geometry);assert.equal(hidden.size,3);for(const box of hidden.values()){assert.equal(box.visible,false);assert.deepEqual([box.width,box.height,box.boxWidth,box.boxHeight],[0,0,0,0]);}
 const toggled=await page.evaluate(async design=>{const shown=structuredClone(design);shown.nodes.find(node=>node.id==="hidden-parent").visible=true;shown.nodes.find(node=>node.id==="hidden-own").visible=true;const stale=renderer.setScene(design),fresh=renderer.setScene(shown);return{results:await Promise.all([stale,fresh]),geometry:[...renderer.geometry()],hit:renderer.hitTest({x:35,y:40})};},design);
 assert.deepEqual(toggled.results,[false,true]);const visible=new Map(toggled.geometry);assert(visible.get("hidden-parent").width>0&&visible.get("hidden-child").height===30);assert(visible.get("hidden-own").height>0);assert.equal(toggled.hit,"hidden-child");
 if(evidence)await writeFile(join(evidence,"hidden-hug-toggle.json"),JSON.stringify({cpuOnly:true,toggled},null,2)+"\n");
});

test("dispose immediately retires owned pending DOM and FontFaces before a delayed decoder settles",async t=>{
 const {page}=await fixture(t),design=poisoned();
 const proof=await page.evaluate(async design=>{
  const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(n=>n.toString(16).padStart(2,"0")).join("");
  const fontBytes=new Uint8Array(await(await fetch("/fonts/InterVariable.woff2")).arrayBuffer());const font={id:"font",kind:"font",mime:"font/woff2",bytes:fontBytes.length,sha256:await sha(fontBytes),partCount:1,family:"Owned Font",weight:400,style:"normal"};
  const canvas=document.createElement("canvas");canvas.width=canvas.height=2;canvas.getContext("2d").fillRect(0,0,2,2);const imageBytes=new Uint8Array(await(await fetch(canvas.toDataURL())).arrayBuffer()),image={id:"image",kind:"image",mime:"image/png",bytes:imageBytes.length,sha256:await sha(imageBytes),partCount:1};
  design.resources=[font,image];const text=design.nodes.find(node=>node.id==="text");text.fontRef="font";text.fontFamily="Owned Font, Arial";design.nodes.push({id:"image-node",type:"image",name:"image",x:700,y:20,width:2,height:2,fill:"transparent",stroke:"transparent",strokeWidth:0,opacity:1,rotation:0,visible:true,locked:false,cornerRadius:0,imageRef:"image"});design.pages[0].nodes=design.nodes;
  const resources=new Map([["font",{descriptor:font,bytes:fontBytes,mimeType:font.mime}],["image",{descriptor:image,bytes:imageBytes,mimeType:image.mime}]]),raw=JSON.stringify(design),baseline={faces:document.fonts.size,hosts:document.body.children.length};
  const decode=HTMLImageElement.prototype.decode;let started,release;const began=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
  HTMLImageElement.prototype.decode=async function(){await decode.call(this);started();await gate;};
  const pending=renderer.setScene(design,{resources});await began;const staged={faces:document.fonts.size,hosts:document.body.children.length};renderer.dispose();const immediate={faces:document.fonts.size,hosts:document.body.children.length};release();const accepted=await pending;HTMLImageElement.prototype.decode=decode;
  const final={faces:document.fonts.size,hosts:document.body.children.length};return{baseline,staged,immediate,final,accepted,sourceUnchanged:raw===JSON.stringify(design)};
 },design);
 if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,"pending-dispose.json"),JSON.stringify({cpuOnly:true,proof},null,2)+"\n");}
 assert.equal(proof.staged.faces,proof.baseline.faces+2);assert.equal(proof.staged.hosts,proof.baseline.hosts+1);assert.deepEqual(proof.immediate,proof.baseline);assert.deepEqual(proof.final,proof.baseline);assert.equal(proof.accepted,false);assert(proof.sourceUnchanged);
});

test("fixed component instances preserve master opacity, clipping and center rotation before nonuniform outer scaling",async t=>{
 const {page}=await fixture(t);
 const master=base("master","component",1000,2000,100,60,{fill:"#ff0000",opacity:.25,rotation:30,clipContent:true,cornerRadius:12,children:[base("overflow","rectangle",980,1990,140,80,{fill:"#0000ff"})]});
 const design=normalizeDesignDocument({format:"codeshell.design",version:3,name:"Component transforms",canvas:{width:800,height:500,background:"#ffffff"},tokens:{colors:[]},resources:[],activePageId:"page",pages:[{id:"page",name:"Page",children:[base("same","instance",40,70,100,60,{fill:"transparent",componentId:"master",opacity:.8,rotation:15}),base("scaled","instance",280,100,160,30,{fill:"transparent",componentId:"master",opacity:.6,rotation:-20})]},{id:"library",name:"Library",children:[master]}]});
 const raw=JSON.stringify(design);
 const actualGeometry=await page.evaluate(async design=>{await renderer.setScene(design);renderer.resize(800,500);renderer.render();return[...renderer.geometry()];},design),converted=await page.screenshot();
 await page.evaluate(()=>{
  document.querySelector("#surface").style.visibility="hidden";const reference=document.createElement("div");reference.style.cssText="position:absolute;inset:0;background:white";
  for(const [x,y,width,height,opacity,rotation]of [[40,70,100,60,.8,15],[280,100,160,30,.6,-20]]){
   const outer=document.createElement("div");outer.style.cssText=`position:absolute;left:${x}px;top:${y}px;width:${width}px;height:${height}px;opacity:${opacity};transform:rotate(${rotation}deg);transform-origin:50% 50%`;
   const scale=document.createElement("div");scale.style.cssText=`position:absolute;left:0;top:0;width:100px;height:60px;transform:scale(${width/100},${height/60});transform-origin:0 0`;
   const master=document.createElement("div");master.style.cssText="position:absolute;left:0;top:0;width:100px;height:60px;opacity:.25;overflow:hidden;border-radius:12px;background:red;transform:rotate(30deg);transform-origin:50% 50%";
   const child=document.createElement("div");child.style.cssText="position:absolute;left:-20px;top:-10px;width:140px;height:80px;background:blue";master.append(child);scale.append(master);outer.append(scale);reference.append(outer);
  }document.body.append(reference);
 });
 const source=await page.screenshot(),comparison=pixelDiff(source,converted);
 if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,"component-source.png"),source);await writeFile(join(evidence,"component-converted.png"),converted);await writeFile(join(evidence,"component-diff.png"),comparison.png);await writeFile(join(evidence,"component-transform.json"),JSON.stringify({cpuOnly:true,differentPixels:comparison.differentPixels,maxDelta:comparison.maxDelta,actualGeometry,canonical:JSON.parse(raw),unchanged:raw===JSON.stringify(design)},null,2)+"\n");}
 assert.equal(comparison.differentPixels,0);assert.equal(raw,JSON.stringify(design));
});

test("Fill instances explicitly refuse before publication and recover with authored Fixed dimensions",async t=>{
 const {page}=await fixture(t);
 const master=base("master","component",0,0,100,30,{fill:"transparent",children:[base("blue","rectangle",0,0,100,30,{fill:"#0000ff"})]});
 const design=normalizeDesignDocument({format:"codeshell.design",version:3,name:"Instance capability",canvas:{width:800,height:500,background:"#ffffff"},tokens:{colors:[]},resources:[],activePageId:"page",pages:[{id:"page",name:"Page",children:[base("root","frame",20,20,320,50,{layout:"vertical",padding:10,fill:"#eeeeee",layoutSizingVertical:"hug",children:[base("fill-instance","instance",9000,9000,9999,30,{componentId:"master",fill:"transparent",layoutSizingHorizontal:"fill"})]})]},{id:"library",name:"Library",children:[master]}]});
 const attempt=await page.evaluate(async({safe,design})=>{await renderer.setScene(safe);renderer.resize(800,500);renderer.render();const prior=[...renderer.geometry()],raw=JSON.stringify(design);let error=null;try{await renderer.setScene(design);}catch(cause){error=cause.message;}return{error,prior,after:[...renderer.geometry()],sourceUnchanged:raw===JSON.stringify(design)};},{safe:poisoned(),design});
 const converted=await page.screenshot();
 await page.evaluate(()=>{document.querySelector("#surface").style.visibility="hidden";const reference=document.createElement("div");reference.id="fill-reference";reference.style.cssText="position:absolute;inset:0;background:white";reference.innerHTML='<div style="position:absolute;left:20px;top:20px;width:320px;height:50px;padding:10px;box-sizing:border-box;background:#eee;display:flex;flex-direction:column"><div style="width:300px;height:30px;flex-shrink:0;background:blue"></div></div>';document.body.append(reference);});
 const source=await page.screenshot(),refused=attempt.error?.includes("BROWSER_INSTANCE_SIZING_UNSUPPORTED:")===true,bad=refused?null:pixelDiff(source,converted);
 if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,"fill-instance-reference.png"),source);await writeFile(join(evidence,"fill-instance-attempt.png"),converted);if(bad)await writeFile(join(evidence,"fill-instance-diff.png"),bad.png);await writeFile(join(evidence,"fill-instance-attempt.json"),JSON.stringify({cpuOnly:true,refused,attempt,canonical:design,differentPixels:bad?.differentPixels??null,maxDelta:bad?.maxDelta??null},null,2)+"\n");}
 await page.evaluate(()=>{document.querySelector("#fill-reference").remove();document.querySelector("#surface").style.visibility="";});
 assert(refused);assert.deepEqual(attempt.after,attempt.prior);assert(attempt.sourceUnchanged);
 const fixed=structuredClone(design);Object.assign(fixed.nodes.find(node=>node.id==="fill-instance"),{width:300,layoutSizingHorizontal:"fixed"});
 const recovered=await page.evaluate(async design=>{await renderer.setScene(design);return renderer.geometry().get("fill-instance");},fixed),fixedPng=await page.screenshot(),comparison=pixelDiff(source,fixedPng);
 if(evidence){await writeFile(join(evidence,"fixed-instance-recovered.png"),fixedPng);await writeFile(join(evidence,"fixed-instance-diff.png"),comparison.png);await writeFile(join(evidence,"fixed-instance-recovered.json"),JSON.stringify({cpuOnly:true,recovered,differentPixels:comparison.differentPixels,maxDelta:comparison.maxDelta},null,2)+"\n");}
 assert.deepEqual([recovered.x,recovered.y,recovered.width,recovered.height],[30,30,300,30]);assert.equal(comparison.differentPixels,0);
});

test("visible scalar instance shadows refuse before publication, including nested instances, and clearing recovers",async t=>{
 const {page}=await fixture(t),shadow={color:"#000000",opacity:.5,x:20,y:10,blur:0};
 const master=base("master","component",500,500,100,30,{fill:"transparent",children:[base("blue","rectangle",500,500,100,30,{fill:"#0000ff"})]});
 const source={format:"codeshell.design",version:3,name:"Instance shadow",canvas:{width:800,height:500,background:"#ffffff"},tokens:{colors:[]},resources:[],activePageId:"page",pages:[{id:"page",name:"Page",children:[base("instance","instance",40,40,100,30,{fill:"transparent",componentId:"master",shadow})]},{id:"library",name:"Library",children:[master]}]};
 const design=normalizeDesignDocument(source),safe=structuredClone(design);delete safe.nodes[0].shadow;
 const nestedSource=structuredClone(source);nestedSource.pages[0].children[0].componentId="parent";delete nestedSource.pages[0].children[0].shadow;nestedSource.pages[1].children.push(base("parent","component",0,0,100,30,{fill:"transparent",children:[base("inner","instance",0,0,100,30,{fill:"transparent",componentId:"master",shadow})]}));
 const nested=normalizeDesignDocument(nestedSource);
 const proof=await page.evaluate(async({safe,design,nested})=>{
  await renderer.setScene(safe);renderer.resize(800,500);renderer.render();const prior=[...renderer.geometry()],raw=JSON.stringify(design),nestedRaw=JSON.stringify(nested);const errors=[];
  for(const candidate of [design,nested])try{await renderer.setScene(candidate);errors.push(null);}catch(error){errors.push({code:error.code,message:error.message});}
  const retained=JSON.stringify(prior)===JSON.stringify([...renderer.geometry()]);const inactive=structuredClone(design);inactive.nodes[0].shadow.opacity=0;const acceptedInactive=await renderer.setScene(inactive);await renderer.setScene(safe);
  return{errors,retained,acceptedInactive,sourceUnchanged:raw===JSON.stringify(design),nestedUnchanged:nestedRaw===JSON.stringify(nested),recovered:renderer.geometry().get("instance")};
 },{safe,design,nested});
 const converted=await page.screenshot(),svg=exportDesignSvg(safe);await page.evaluate(svg=>{renderer.dispose();document.body.innerHTML=svg;},svg);const reference=await page.screenshot(),comparison=pixelDiff(reference,converted);
 if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,"instance-shadow-cleared-reference.png"),reference);await writeFile(join(evidence,"instance-shadow-cleared-converted.png"),converted);await writeFile(join(evidence,"instance-shadow-cleared-diff.png"),comparison.png);await writeFile(join(evidence,"instance-shadow-guard.json"),JSON.stringify({cpuOnly:true,proof,differentPixels:comparison.differentPixels,maxDelta:comparison.maxDelta},null,2)+"\n");}
 assert(proof.errors.every(error=>error?.code==="BROWSER_INSTANCE_EFFECT_UNSUPPORTED"));assert(proof.retained&&proof.acceptedInactive&&proof.sourceUnchanged&&proof.nestedUnchanged);assert.deepEqual([proof.recovered.x,proof.recovered.y,proof.recovered.width,proof.recovered.height],[40,40,100,30]);assert.equal(comparison.differentPixels,0);
});
