import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const app=resolve(fileURLToPath(new URL('../../../apps/design-studio/app/',import.meta.url)));
const evidence=process.env.CODESHELL_FONT_FAMILY_EVIDENCE_DIR;

test('software CanvasKit missing-glyph resource aliases retain the exact remaining CSS fallback stack',async t=>{
  const browser=await chromium.launch({args:['--disable-gpu']});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:700,height:170},deviceScaleFactor:1}),errors=[],blocked=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.origin!=='https://font-renderer.test'){blocked.push(u.href);return route.abort();}
    if(u.pathname==='/')return route.fulfill({body:'<!doctype html>',contentType:'text/html'});
    const file=resolve(app,'.'+u.pathname);if(!file.startsWith(app+sep))return route.abort();
    return route.fulfill({body:await readFile(file),contentType:{'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.woff2':'font/woff2'}[extname(file)]});
  });
  await page.goto('https://font-renderer.test/');await page.addScriptTag({url:'/canvas/vendor/canvaskit.js'});
  const rows=await page.evaluate(async retain=>{
    const contexts=[],getContext=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){contexts.push(kind);return getContext.call(this,kind,...args);};
    const CK=await CanvasKitInit({locateFile:file=>'/canvas/vendor/'+file});
    const {createCanvasKitText}=await import('/canvas/canvaskit-text.mjs');
    const {designNamedFontFamilyCss}=await import('/font-css.mjs');
    const {textRangeSourceSignature}=await import('/text-ranges.mjs');
    const bytes=new Uint8Array(await(await fetch('/fonts/fa-solid-900.woff2')).arrayBuffer()),rows=[];
    for(const [family,css,mismatch]of[
      ['CaseFamily','CaseFamily, monospace',false],
      ['Case, Family','"Case, Family", monospace',false],
      ['Case"Family','"Case\\\"Family", monospace',false],
      ['CaseFamily','Arial, monospace',true],
    ]){
      // The constructor accepts a literal family; CSS quoting belongs only in
      // font declarations used to select it (including literal comma/quote names).
      const face=new FontFace(family,bytes,{weight:'900'});await face.load();document.fonts.add(face);await document.fonts.ready;
      const descriptor={id:'font',kind:'font',family,weight:900,style:'normal'};
      const node={id:'copy',type:'text',name:'copy',x:20,y:20,width:660,height:100,text:'MMMM iii WWWW 0123456789',fontFamily:css,fontRef:'font',fontSize:28,fontWeight:900,fontStyle:'normal',lineHeight:1.5,textAlign:'left',fill:'#000000',stroke:'transparent',strokeWidth:0,opacity:1,rotation:0,cornerRadius:0,visible:true,locked:false};
      const design={nodes:[node],resources:[descriptor]},raw=JSON.stringify(design),resources=new Map([['font',{bytes,mimeType:'font/woff2',descriptor}]]),counters={textLines:0,rasterTextNodes:0,nativeTextNodes:0,gradientPaints:0},warnings=[];
      const renderer=await createCanvasKitText({CK,design,resources,document,fallbackFontUrls:new Map(),counters,unsupportedNode:(_n,code)=>warnings.push(code),makePaint:(_node,fill)=>{const p=new CK.Paint();p.setAntiAlias(true);p.setColor(CK.Color(...[1,3,5].map(i=>parseInt(fill.color.slice(i,i+2),16)),fill.opacity));return p;}});
      const outputs=[];
      try{
        const control={...node,fontFamily:mismatch?designNamedFontFamilyCss(family):css};delete control.fontRef;
        for(const current of[node,control]){
          // MakeSurface is a CPU raster surface, never a WebGL/GPU surface.
          const surface=CK.MakeSurface(700,170),canvas=surface.getCanvas();
          try{canvas.clear(CK.WHITE);renderer.draw(canvas,current);surface.flush();const image=surface.makeImageSnapshot();
            try{outputs.push({pixels:image.readPixels(0,0,{width:700,height:170,colorType:CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB}),...(retain?{png:Array.from(image.encodeToBytes(CK.ImageFormat.PNG,100))}:{})});}finally{image.delete();}
          }finally{surface.delete();}
        }
        let changedPixels=0;for(let i=0;i<outputs[0].pixels.length;i+=4)if([0,1,2,3].some(c=>outputs[0].pixels[i+c]!==outputs[1].pixels[i+c]))changedPixels++;
        const measured=document.createElement('canvas').getContext('2d'),measure=family=>{measured.font='900 28px '+family;return measured.measureText(node.text).width;};
        let rangeRefusal;try{renderer.draw({drawImageRect(){throw Error('must refuse before raster drawing');}},{...node,textRanges:{version:1,sourceSignature:textRangeSourceSignature(node.text),ranges:[{start:0,end:2,fill:'#991122'}]}});}catch(error){rangeRefusal=error.code;}
        rows.push({family,css,mismatch,changedPixels,widthExpected:measure(mismatch?designNamedFontFamilyCss(family):css),widthWithoutFallback:measure(designNamedFontFamilyCss(family)),warnings,rangeRefusal,counters:{...counters},stats:renderer.stats(),stateUnchanged:JSON.stringify(design)===raw,bytesUnchanged:resources.get('font').bytes===bytes,contexts:[...new Set(contexts)],...(retain?{pngs:outputs.map(o=>o.png)}:{})});
      }finally{renderer.dispose();document.fonts.delete(face);}
    }
    HTMLCanvasElement.prototype.getContext=getContext;
    return rows;
  },Boolean(evidence));
  assert.equal(rows.length,4);
  for(let i=0;i<rows.length;i++){
    const row=rows[i];assert.equal(row.changedPixels,0,JSON.stringify({...row,pngs:undefined}));
    assert(row.warnings.includes('native-missing-glyph'));assert(row.warnings.includes('native-font-unavailable'));
    assert.equal(row.rangeRefusal,'TEXT_RANGES_UNSUPPORTED');assert.equal(row.counters.nativeTextNodes,0);
    assert(row.stateUnchanged&&row.bytesUnchanged);assert(!row.contexts.some(kind=>/webgl|bitmaprenderer/iu.test(kind)));
    if(!row.mismatch)assert.notEqual(row.widthExpected,row.widthWithoutFallback,'fixture must actually distinguish fallback selection');
    if(evidence){await mkdir(evidence,{recursive:true});for(let n=0;n<row.pngs.length;n++)await writeFile(join(evidence,`${i}-${n?'control':'bound'}.png`),Buffer.from(row.pngs[n]));delete row.pngs;}
  }
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
  if(evidence)await writeFile(join(evidence,'receipt.json'),JSON.stringify({kind:'CPU_SOFTWARE_CANVASKIT_FONT_FALLBACK_CONTROLS',at:new Date().toISOString(),browserArgs:['--disable-gpu'],surface:'CK.MakeSurface CPU raster',rows,errors,blocked},null,2)+'\n');
});
