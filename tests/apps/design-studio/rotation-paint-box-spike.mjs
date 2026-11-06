// Bounded R006 experiment. Uses local Chromium and production CanvasKit/frontend
// modules; all candidate geometry exists only in cloned scenes, never saved data.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import {rotationGeometry} from './render-fidelity-geometry.mjs';
const app=resolve('apps/design-studio/app'), out=resolve(process.env.DESIGN_ROTATION_EVIDENCE??'.tmp/render-fidelity-r006/rotation'),origin='https://rotation-paint.test';
await mkdir(out,{recursive:true});
const hash=x=>createHash('sha256').update(x).digest('hex');
const browser=await chromium.launch({args:process.platform==='darwin'?['--use-angle=metal']:['--enable-webgl','--enable-unsafe-swiftshader']});
const results=[];
try { for(const dpr of [1,2]) {
 const context=await browser.newContext({viewport:{width:360,height:320},deviceScaleFactor:dpr}),page=await context.newPage(),errors=[],blocked=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==origin){blocked.push(url.href);return route.abort();} if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><body style="margin:0;background:white"><canvas></canvas></body>'});const file=resolve(app,`.${decodeURIComponent(url.pathname)}`);if(!file.startsWith(app+sep))return route.abort();try{return route.fulfill({body:await (async()=>{const bytes=await readFile(file);if(url.pathname!=='/canvas/canvaskit-renderer.mjs')return bytes;const source=bytes.toString(),anchor='node.x + node.width / 2,\n        node.y + node.height / 2,';assert(source.includes(anchor));return source.replace(anchor,'node._rotationSpikePivotX ?? node.x + node.width / 2,\n        node._rotationSpikePivotY ?? node.y + node.height / 2,');})(),contentType:{'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.woff2':'font/woff2','.ttf':'font/ttf'}[extname(file)]});}catch{return route.fulfill({status:404,body:'missing'});}});
 await page.goto(origin);
 const setup=await page.evaluate(async()=>{
  const {applyAllAutoLayouts}=await import('/layout.mjs');const {browserPaintBoxes}=await import('/canvas/browser-paint-box.mjs');
  const nodes=[],cases=[],angles=[40,-40,45,-45],phases=[0,.3,.5,.65],dims=[[4.2,1],[3.4,1.19],[5.1,1.19]];
  const base=(id,type,x,y,width,height,extra={})=>({id,name:id,type,x,y,width,height,fill:'#000000',stroke:'transparent',strokeWidth:0,opacity:1,rotation:0,cornerRadius:0,visible:true,...extra});
  for(let a=0;a<4;a++)for(let p=0;p<4;p++){const id=`a${a}-p${p}`,flow=(a+p)%2===1,[width,height]=dims[(a+2*p)%3],x=40+p*75+phases[p],y=40+a*65+.3;
   if(flow)nodes.push(base(`parent-${id}`,'frame',x-.17,y-.17,30,30,{fill:'transparent',layout:'horizontal',padding:.17,gap:.23,alignItems:'start',justifyContent:'start'}));
   const node=base(id,'rectangle',x,y,width,height,{rotation:angles[a],...(flow?{parentId:`parent-${id}`}:{})});nodes.push(node);cases.push({id,flow,xPhase:phases[p],nominalX:x,width,height,rotation:angles[a]});
  }
  applyAllAutoLayouts(nodes);
  const design={format:'codeshell.design',version:3,name:'R006 rotation L16',canvas:{width:360,height:320,background:'#ffffff'},resources:[],nodes,activePageId:'main',pages:[{id:'main',name:'Main',nodes}]};
  const replay=browserPaintBoxes(nodes.map(n=>({...n,rotation:0})));
  window.design=design;window.cases=cases;window.replays=Object.fromEntries(replay.layoutBoxes);
  const {renderDesignFrontendPage,designFrontendCss}=await import('/frontend-export.mjs');
  const wrapper=document.createElement('div');wrapper.id='html';wrapper.style.cssText='position:absolute;left:0;top:0;width:360px;height:320px';wrapper.innerHTML=`<style>${designFrontendCss(design)}.cs-page{margin:0!important}</style>${renderDesignFrontendPage(design)}`;document.body.append(wrapper);
  const box=r=>({x:r.x,y:r.y,width:r.width,height:r.height});
  const dom=cases.map(c=>{const el=wrapper.querySelector(`[data-codeshell-id="${c.id}"]`),style=getComputedStyle(el),transformed=box(el.getBoundingClientRect()),clone=wrapper.cloneNode(true);clone.id='unrotated';clone.style.visibility='hidden';document.body.append(clone);const target=clone.querySelector(`[data-codeshell-id="${c.id}"]`);target.style.transform='none';const unrotated=box(target.getBoundingClientRect());clone.remove();return {...c,saved:nodes.find(n=>n.id===c.id),replay:window.replays[c.id],computed:{transform:style.transform,transformOrigin:style.transformOrigin,width:style.width,height:style.height,left:style.left,top:style.top,position:style.position},transformed,unrotated};});
  return {design,cases:dom};
 });
 await writeFile(resolve(out,`dpr${dpr}-source.json`),JSON.stringify(setup,null,2));
 const reference=PNG.sync.read(await page.screenshot({path:resolve(out,`dpr${dpr}-html.png`),scale:'device'}));
 await page.evaluate(async dpr=>{document.querySelector('#html').style.display='none';const {createRenderer}=await import('/canvas/canvaskit-renderer.mjs');window.renderer=await createRenderer({canvas:document.querySelector('canvas'),assetsBaseUrl:'/canvas/vendor/',tileCacheEnabled:false,background:'#ffffff'});renderer.resize(360,320,dpr);},dpr);
 for(const candidate of ['a-current','b-layout-unit','c-round-translation','d-snap-edges','e-local-paint-lu-origin']){
  const stats=await page.evaluate(async candidate=>{const source=structuredClone(window.design);for(const node of source.nodes){if(!node.rotation)continue;const b=window.replays[node.id];if(b.reason)throw Error(b.reason);if(candidate==='a-current')continue;Object.assign(node,b);if(candidate==='c-round-translation'){node.x=Math.round(node.x);node.y=Math.round(node.y);}if(candidate==='d-snap-edges'){const x=Math.round(node.x),y=Math.round(node.y);node.width=Math.round(node.x+node.width)-x;node.height=Math.round(node.y+node.height)-y;node.x=x;node.y=y;}if(candidate==='e-local-paint-lu-origin'){node.x=Math.round(b.x);node.y=Math.round(b.y);node.width=Math.round(b.width);node.height=Math.round(b.height);node._rotationSpikePivotX=node.x+b.width/2;node._rotationSpikePivotY=node.y+b.height/2;}}
   await renderer.setScene(source);renderer.render({zoom:1});return renderer.stats();},candidate);
  const image=PNG.sync.read(await page.screenshot({path:resolve(out,`dpr${dpr}-${candidate}.png`),scale:'device'}));
  for(const c of setup.cases){const roi={x:(c.saved.x-6)*dpr,y:(c.saved.y-6)*dpr,width:20*dpr,height:20*dpr},expected=rotationGeometry(reference,{roi}),actual=rotationGeometry(image,{roi});assert(expected&&actual,`stable moments ${c.id}`);const centroid=Math.hypot(actual.centroidX-expected.centroidX,actual.centroidY-expected.centroidY),angle=((actual.angleDegrees-expected.angleDegrees+270)%180)-90,areaRatio=actual.mass/expected.mass;results.push({dpr,candidate,...c,roi,reference:expected,actual,centroid,angle,areaRatio,strictPass:centroid<=.1&&Math.abs(angle)<=.1&&Math.abs(areaRatio-1)<=.02,exceptionPass:centroid<=1&&Math.abs(angle)<=.5});}
  await writeFile(resolve(out,`dpr${dpr}-${candidate}-stats.json`),JSON.stringify({stats,errors,blocked},null,2));
 }
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);await context.close();
} } finally {await browser.close();}
const summaries=['a-current','b-layout-unit','c-round-translation','d-snap-edges','e-local-paint-lu-origin'].map(candidate=>{const rows=results.filter(r=>r.candidate===candidate);return {candidate,rows:rows.length,strictPass:rows.filter(r=>r.strictPass).length,exceptionPass:rows.filter(r=>r.exceptionPass).length,maxCentroid:Math.max(...rows.map(r=>r.centroid)),maxAngle:Math.max(...rows.map(r=>Math.abs(r.angle))),minAreaRatio:Math.min(...rows.map(r=>r.areaRatio)),maxAreaRatio:Math.max(...rows.map(r=>r.areaRatio))};});
const report={created:new Date().toISOString(),matrix:'16 angle×phase orthogonal rows, balanced absolute/flow and three dimensions; DPR1/2',definitions:{a:'saved geometry, existing renderer',b:'LayoutUnit replay rectangle, exact rotation about replay center, no snap',c:'b translated to round CSS x/y, same dimensions',d:'four world LayoutUnit edges rounded to CSS pixel, rotate about resulting center',e:'minimal counterexample follow-up: rounded world translation, independently rounded local width/height, unsnapped LayoutUnit local transform origin; private CanvasKit pivot hook only'},sourceHash:hash(await readFile(import.meta.filename)),thresholds:{centroidDevicePx:.1,angleDeg:.1,areaRelative:.02,exceptionCentroidDevicePx:1,exceptionAngleDeg:.5},summaries,results};
await writeFile(resolve(out,'spike.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(summaries,null,2));
