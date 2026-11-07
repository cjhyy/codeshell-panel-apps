// Bounded real rounded-leaf AA experiment. Candidates never alter production bytes.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { normalizeDesignDocument } from '../../../apps/design-studio/app/document.mjs';
import { browserPaintBoxes } from '../../../apps/design-studio/app/canvas/browser-paint-box.mjs';
import { isolateFidelityDesign } from './render-fidelity-attribution.mjs';
import { rotationMomentRoi } from './rotation-moment-roi.mjs';
import { compareRotationGeometry } from './render-fidelity-geometry.mjs';
import { shapePixelQualification, parseRgb, inkGeometry } from './render-fidelity.metrics.mjs';
const app=resolve('apps/design-studio/app'),out=resolve(process.env.DESIGN_ROTATION_EVIDENCE??'.tmp/render-fidelity-r009/rounded-aa-spike');
const input=process.env.DESIGN_FIDELITY_REAL_FIXTURE??'/Users/admin/.codex/worktrees/codeshell-cross-platform-design-20261106/designs/codeshell-web-refined.backup.json';
const bytes=await readFile(input),design=normalizeDesignDocument(JSON.parse(bytes).document),hash=x=>createHash('sha256').update(x).digest('hex');
const all=design.pages.flatMap(page=>page.nodes.filter(node=>node.rotation).map(node=>({page:page.id,node})));
const selected=new Map();for(const row of all){const n=row.node,key=JSON.stringify([n.width,n.height,n.cornerRadius,n.rotation]);if(!selected.has(key))selected.set(key,{...row,signature:key});}
// Include the fourth requested real failure even though its shape duplicates web-chat-32.
for(const id of ['web-chat-167','web-chat-110','web-chat-32','android-chat-43']){const row=all.find(row=>row.node.id===id);if(![...selected.values()].some(item=>item.node.id===id))selected.set(id,{...row,signature:JSON.stringify([row.node.width,row.node.height,row.node.cornerRadius,row.node.rotation])});}
const cases=[...selected.values()].map(row=>{const page=design.pages.find(page=>page.id===row.page),replay=browserPaintBoxes(page.nodes),node=row.node,index=new Map(page.nodes.map(n=>[n.id,n]));let background=design.canvas.background;for(let parent=index.get(node.parentId);parent;parent=index.get(parent.parentId)){if(parseRgb(parent.fill)){background=parent.fill;break;}}
 const active={...design,nodes:page.nodes,activePageId:page.id};return {...row,box:replay.nodes.get(node.id),layout:replay.layoutBoxes.get(node.id),pivot:replay.rotationPivots.get(node.id),background,isolated:isolateFidelityDesign(active,node.id).design,tile:{x:Math.floor(node.x)-16,y:Math.floor(node.y)-16}};});
assert.equal(all.length,77);assert(cases.every(row=>row.pivot));await mkdir(out,{recursive:true});
const origin='https://rounded-aa-spike.test',results=[],summaries=[],captures=[];
const browser=await chromium.launch({args:process.platform==='darwin'?['--use-angle=metal']:['--enable-webgl','--enable-unsafe-swiftshader']});
try{for(const dpr of [1,2]){
 const context=await browser.newContext({viewport:{width:64,height:64},deviceScaleFactor:dpr}),page=await context.newPage(),errors=[],blocked=[];
 page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==origin){blocked.push(url.href);return route.abort();}if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><body style="margin:0;overflow:hidden"><div id="html"></div><canvas id="gpu" style="position:absolute;inset:0;display:none"></canvas></body>'});const file=resolve(app,`.${decodeURIComponent(url.pathname)}`);if(!file.startsWith(app+sep))return route.abort();try{return route.fulfill({body:await readFile(file),contentType:{'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.woff2':'font/woff2','.ttf':'font/ttf'}[extname(file)]});}catch{return route.fulfill({status:404,body:'missing'});}});
 await page.goto(origin);
 await page.evaluate(async dpr=>{
  await new Promise((done,fail)=>{const script=document.createElement('script');script.src='/canvas/vendor/canvaskit.js';script.onload=done;script.onerror=fail;document.head.append(script);});
  const CK=window.CK=await CanvasKitInit({locateFile:file=>'/canvas/vendor/'+file}),canvas=document.querySelector('#gpu');canvas.width=64*dpr;canvas.height=64*dpr;canvas.style.width=canvas.style.height='64px';const handle=CK.GetWebGLContext(canvas,{majorVersion:2,alpha:true,antialias:false,preserveDrawingBuffer:false});assertNonzero(handle);const context=window.glContext=CK.MakeWebGLContext(handle);window.surface=CK.MakeOnScreenGLSurface(context,canvas.width,canvas.height,CK.ColorSpace.SRGB);window.dpr=dpr;
  function assertNonzero(v){if(!v)throw Error('local dedicated WebGL2 unavailable');}
 },dpr);
 for(const c of cases){
  const base=`dpr${dpr}-${c.page}-${c.node.id}`,htmlPath=resolve(out,`${base}-html.png`);
  const dom=await page.evaluate(async c=>{
   const {renderDesignFrontendPage,designFrontendCss}=await import('/frontend-export.mjs');document.querySelector('#gpu').style.display='none';const wrapper=document.querySelector('#html');wrapper.style.display='block';wrapper.innerHTML=`<style>${designFrontendCss(c.isolated,{preserveWorldOrigin:true})}html,body{margin:0;overflow:hidden;background:${c.background}}#world{position:absolute;left:${-c.tile.x}px;top:${-c.tile.y}px;transform-origin:0 0}.cs-page{margin:0!important;overflow:visible!important}</style><div id="world">${renderDesignFrontendPage(c.isolated,{preserveWorldOrigin:true})}</div>`;
   const el=wrapper.querySelector(`[data-codeshell-id="${c.node.id}"]`),style=getComputedStyle(el),r=el.getBoundingClientRect();return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},transform:style.transform,transformOrigin:style.transformOrigin,borderRadius:style.borderRadius,computedWidth:style.width,computedHeight:style.height};
  },c);
  const reference=PNG.sync.read(await page.screenshot({path:htmlPath,scale:'device'}));
  for(const candidate of ['P0','P1','P2']){
   const receipt=await page.evaluate(({c,candidate})=>{
    const {CK,surface,dpr}=window,canvas=surface.getCanvas(),color=value=>CK.Color(...[1,3,5].map(i=>parseInt(value.slice(i,i+2),16)),1);document.querySelector('#html').style.display='none';document.querySelector('#gpu').style.display='block';canvas.clear(color(c.background));const paint=new CK.Paint();paint.setAntiAlias(true);paint.setColor(color(c.node.fill));
    const n=c.box,p=c.pivot,dx=-c.tile.x,dy=-c.tile.y,radius=c.node.cornerRadius,roundRadius=Math.min(radius,n.width/2,n.height/2),rect=CK.XYWHRect(n.x,n.y,n.width,n.height),rrect=[...rect,...Array(4).fill(roundRadius).flatMap(r=>[r,r])];
    let extra={};if(candidate==='P2'){
     const raster=document.createElement('canvas');raster.width=raster.height=64*dpr;const ctx=raster.getContext('2d',{willReadFrequently:true});ctx.scale(dpr,dpr);ctx.translate(dx,dy);ctx.translate(p.x,p.y);ctx.rotate(n.rotation*Math.PI/180);ctx.translate(-p.x,-p.y);ctx.fillStyle=n.fill;ctx.beginPath();ctx.roundRect(n.x,n.y,n.width,n.height,radius);ctx.fill();const image=CK.MakeImage({width:raster.width,height:raster.height,colorType:CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB},ctx.getImageData(0,0,raster.width,raster.height).data,raster.width*4);if(!image)throw Error('P2 image creation failed');canvas.drawImageRectOptions(image,CK.XYWHRect(0,0,raster.width,raster.height),CK.XYWHRect(0,0,raster.width,raster.height),CK.FilterMode.Nearest,CK.MipmapMode.None,paint);image.delete();extra={physicalPixels:raster.width*raster.height,transform:'device scale; view translation; rule-e pivot rotation; no GPU rotation'};
    }else{canvas.save();canvas.scale(dpr,dpr);canvas.translate(dx,dy);canvas.rotate(n.rotation,p.x,p.y);if(candidate==='P0')canvas.drawRRect(rrect,paint);else{const x=n.x,y=n.y,w=n.width,h=n.height,r=roundRadius,path=CK.Path.MakeFromSVGString(`M${x+r} ${y}H${x+w-r}A${r} ${r} 0 0 1 ${x+w} ${y+r}V${y+h-r}A${r} ${r} 0 0 1 ${x+w-r} ${y+h}H${x+r}A${r} ${r} 0 0 1 ${x} ${y+h-r}V${y+r}A${r} ${r} 0 0 1 ${x+r} ${y}Z`);if(!path)throw Error('P1 path creation failed');canvas.drawPath(path,paint);path.delete();}canvas.restore();}
    paint.delete();surface.flush();return extra;
   },{c,candidate});
   const pngPath=resolve(out,`${base}-${candidate}.png`),actual=PNG.sync.read(await page.screenshot({path:pngPath,scale:'device'})),roi={x:7*dpr,y:7*dpr,width:38*dpr,height:38*dpr};
   const inkOptions={roi,foreground:parseRgb(c.node.fill),background:parseRgb(c.background)},referenceInk=inkGeometry(reference,inkOptions),actualInk=inkGeometry(actual,inkOptions),momentRoi=rotationMomentRoi({node:c.node,tile:c.tile,scale:dpr,referenceInk,actualInk});assert(momentRoi,'bounded own-fill ROI');const geometry=compareRotationGeometry(reference,actual,{roi:momentRoi,foreground:parseRgb(c.node.fill),background:parseRgb(c.background),localLongEdgeCss:Math.max(c.box.width,c.box.height),scale:dpr}),pixels=shapePixelQualification(reference,actual,{roi:momentRoi,geometryPassed:geometry.measurable&&!geometry.failures.length});
   const row={candidate,dpr,page:c.page,id:c.node.id,signature:c.signature,node:c.node,box:c.box,layout:c.layout,pivot:c.pivot,tile:c.tile,dom,background:c.background,referencePath:htmlPath,actualPath:pngPath,roi,momentRoi,referenceInk,actualInk,geometry,pixels,pass:geometry.measurable&&!geometry.failures.length&&(pixels.rawPass||pixels.qualified),...receipt};results.push(row);
  }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);captures.push({dpr,errors,blocked});await page.evaluate(()=>{surface.delete();glContext.delete();});await context.close();
}}finally{await browser.close();}
for(const candidate of ['P0','P1','P2']){const rows=results.filter(row=>row.candidate===candidate);summaries.push({candidate,rows:rows.length,pass:rows.filter(row=>row.pass).length,geometryFail:rows.filter(row=>row.geometry.failures.length).length,pixelFail:rows.filter(row=>!row.pixels.rawPass&&!row.pixels.qualified).length,maxAbsDeltaLength:Math.max(...rows.map(row=>Math.abs(row.geometry.lengthDeltaDevicePx))),maxAbsDeltaThickness:Math.max(...rows.map(row=>Math.abs(row.geometry.thicknessDeltaDevicePx))),maxCentroid:Math.max(...rows.map(row=>row.geometry.centroid)),maxEndpoint:Math.max(...rows.map(row=>row.geometry.endpointDevicePx))});}
const selectedCandidate=summaries.find(summary=>summary.rows===summary.pass)?.candidate??null;
assert.equal(hash(await readFile(input)),hash(bytes),'read-only real source remains unchanged');
const report={created:new Date().toISOString(),input:{path:input,sha256:hash(bytes),realRotationNodes:all.length,uniqueSignedGeometrySignatures:new Set(all.map(({node})=>JSON.stringify([node.width,node.height,node.cornerRadius,node.rotation]))).size,cases:cases.length},scriptSha256:hash(await readFile(import.meta.filename)),definitions:{P0:'current rule-e drawRRect',P1:'same exact circular rounded rectangle encoded as native SVG arc Path then drawPath',P2:'Canvas2D.roundRect with original authored radius after device scale, view translation and rule-e pivot rotation; uploaded then 1:1 nearest drawn with no second GPU rotation'},thresholds:{lengthDevicePx:.5,thicknessDevicePx:.35,centroidDevicePx:.5,endpointDevicePx:.5,pixelMismatchRatio:.001,largestCluster:6},selectedCandidate,summaries,captures,results};
await writeFile(resolve(out,'spike.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({selectedCandidate,summaries},null,2));
