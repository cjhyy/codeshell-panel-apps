import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const app = fileURLToPath(new URL("../../../apps/design-studio/app/", import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

test("real CPU FontFace decoding stages atomically, restores exact leases and removes only owned faces", async t => {
  const browser=await chromium.launch({headless:true,args:["--disable-gpu"]});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1100,height:100},deviceScaleFactor:1});
  const errors=[]; page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/*",async route=>{
    const url=new URL(route.request().url());
    assert.equal(url.origin,"https://owned-fonts.test");
    if(url.pathname==="/") return route.fulfill({body:'<!doctype html><style>body{margin:0;background:white}#probe{font:32px "ProbeDocumentFont20261021",serif;white-space:pre;color:#111}</style><div id="probe">iiii WWWW 0123456789 Hamburgefontsiv</div>',contentType:"text/html"});
    assert(["/owned-fonts.mjs","/font-family.mjs","/font-capabilities.mjs","/builtin-font-catalog.mjs"].includes(url.pathname));
    return route.fulfill({body:await readFile(resolve(app,"."+url.pathname)),contentType:"text/javascript"});
  });
  await page.goto("https://owned-fonts.test/");
  const inter=await readFile(resolve(app,"fonts/InterVariable.woff2")), roboto=await readFile(resolve(app,"fonts/Roboto-Variable.ttf"));
  const rows=await page.evaluate(async ({inter,roboto})=>{
    const {createOwnedFontManager}=await import("/owned-fonts.mjs"), family="ProbeDocumentFont20261021", faces=[];
    const foreign=new FontFace("ProbeForeignFont20261021",`url(data:font/woff2;base64,${inter})`); await foreign.load(); document.fonts.add(foreign);
    const manager=createOwnedFontManager({fontSet:document.fonts,createFace(...args){const face=new FontFace(...args);faces.push(face);return face;}});
    const resource=(id,base64,mime="font/woff2")=>({descriptor:{id,kind:"font",sha256:base64.slice(0,30),bytes:base64.length,mime,family,weight:400,style:"normal"},dataUrl:`data:${mime};base64,${base64}`});
    const a=resource("same-id",inter), b=resource("same-id",roboto,"font/ttf");
    const width=()=>{const canvas=document.createElement("canvas"),context=canvas.getContext("2d");context.font=`32px "${family}",serif`;return context.measureText(document.querySelector("#probe").textContent).width;};
    const set=async (resources,options)=>{const token=manager.begin(),prepared=await manager.prepare(token,resources,options);manager.commit(token,prepared);};
    const rows={fresh:width()};
    let token=manager.begin(), prepared=await manager.prepare(token,[a]); rows.stagedA=width(); rows.stagedAbsent=!document.fonts.has(faces[0]);
    manager.commit(token,prepared); const old=faces[0],lease=manager.captureLease(); rows.a=width(); rows.oldPresent=document.fonts.has(old);
    try { token=manager.begin();await manager.prepare(token,[b,resource("invalid",btoa("invalid actual font bytes"))]); rows.invalidRejected=false; }
    catch(error){rows.invalidRejected=true;rows.invalidError=String(error);}
    rows.afterInvalid=width(); rows.invalidAdded=faces.slice(1).some(face=>document.fonts.has(face));
    await set([b]); rows.sameIdChangedBytes=width(); rows.oldRemoved=!document.fonts.has(old); const next=faces.at(-1);
    rows.restored=manager.restoreLease(lease); rows.afterRollback=width(); rows.exactOldRestored=document.fonts.has(old)&&!document.fonts.has(next);
    await set([]); rows.empty=width(); rows.foreignAfterEmpty=document.fonts.has(foreign);
    await set([a]); const beforeHideLease=manager.captureLease(); manager.suspend(); rows.hidden=width(); rows.hiddenLeaseRefused=!manager.restoreLease(beforeHideLease);
    manager.resume(); await set([a]); rows.resumed=width(); manager.reset(); rows.reset=width(); rows.foreignAfterReset=document.fonts.has(foreign);
    const distinctB={...b,descriptor:{...b.descriptor,id:"second-font"}};
    const raster=()=>{
      const canvas=document.createElement("canvas");canvas.width=1100;canvas.height=100;
      const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,1100,100);
      ctx.font=`32px "${family}",serif`;ctx.fillStyle="#111";ctx.fillText(document.querySelector("#probe").textContent,0,40);
      return ctx.getImageData(0,0,1100,100).data;
    };
    const differentPixels=(a,b)=>{let different=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]||a[i+3]!==b[i+3])different++;return different;};
    await set([a,distinctB]);rows.forward=width();const forward=raster(),created=faces.length;
    await set([distinctB,a]);rows.reusedReversed=width();const reused=raster();rows.reusedNoDecode=faces.length===created;
    manager.reset();await set([distinctB,a]);rows.freshReversed=width();const fresh=raster();
    rows.reusedVsFreshPixels=differentPixels(reused,fresh);rows.forwardVsFreshPixels=differentPixels(forward,fresh);
    rows.foreignAfterReorder=document.fonts.has(foreign);
    manager.reset(); await set([a]); const variableFace=faces.at(-1), variableLease=manager.captureLease();
    const weightWidth=()=>{const ctx=document.createElement("canvas").getContext("2d");ctx.font=`900 32px "${family}",serif`;return ctx.measureText(document.querySelector("#probe").textContent).width;};
    const variableWidth=weightWidth(), variableRaster=raster();
    await set([a],{roles:new Map([[a.descriptor.id,"glyph-fallback"]])}); const fallbackFace=faces.at(-1);
    const authored=new FontFace("ProbeAuthoredFallback20261026",`url(${a.dataUrl})`,{weight:"400",style:"normal"});await authored.load();document.fonts.add(authored);
    const reference=document.createElement("canvas").getContext("2d");reference.font='900 32px "ProbeAuthoredFallback20261026",serif';
    rows.roles={variableWeight:variableFace.weight,fallbackWeight:fallbackFace.weight,variableWidth,fallbackWidth:weightWidth(),authoredWidth:reference.measureText(document.querySelector("#probe").textContent).width,rebuilt:variableFace!==fallbackFace&&!document.fonts.has(variableFace)};
    const decoded=faces.length; await set([a],{roles:new Map([[a.descriptor.id,"glyph-fallback"]])});rows.roles.sameRoleReused=faces.length===decoded;
    await set([a]); rows.roles.primaryRebuilt=faces.at(-1)!==fallbackFace&&!document.fonts.has(fallbackFace);rows.roles.primaryWidth=weightWidth();
    rows.roles.leaseRestored=manager.restoreLease(variableLease)&&document.fonts.has(variableFace);rows.roles.leasePixels=differentPixels(variableRaster,raster());
    document.fonts.delete(authored);manager.reset();
    return rows;
  },{inter:inter.toString("base64"),roboto:roboto.toString("base64")});
  assert.equal(rows.stagedA,rows.fresh); assert(rows.stagedAbsent); assert(rows.oldPresent);
  assert.notEqual(rows.a,rows.fresh); assert(rows.invalidRejected); assert.match(rows.invalidError,/NetworkError|network|font/u);
  assert.equal(rows.afterInvalid,rows.a); assert.equal(rows.invalidAdded,false);
  assert.notEqual(rows.sameIdChangedBytes,rows.a); assert(rows.oldRemoved);
  assert(rows.restored&&rows.exactOldRestored); assert.equal(rows.afterRollback,rows.a);
  assert.equal(rows.empty,rows.fresh); assert(rows.foreignAfterEmpty);
  assert.equal(rows.hidden,rows.fresh); assert(rows.hiddenLeaseRefused); assert.equal(rows.resumed,rows.a);
  assert.equal(rows.reset,rows.fresh); assert(rows.foreignAfterReset); assert.deepEqual(errors,[]);
  assert(rows.reusedNoDecode);assert.notEqual(rows.forward,rows.freshReversed);
  assert.equal(rows.reusedReversed,rows.freshReversed);assert.equal(rows.reusedVsFreshPixels,0);
  assert(rows.forwardVsFreshPixels>0);assert(rows.foreignAfterReorder);
  assert.equal(rows.roles.variableWeight,"100 900");assert.equal(rows.roles.fallbackWeight,"400");assert(rows.roles.rebuilt&&rows.roles.sameRoleReused&&rows.roles.primaryRebuilt&&rows.roles.leaseRestored);
  assert.equal(rows.roles.fallbackWidth,rows.roles.authoredWidth);assert.notEqual(rows.roles.fallbackWidth,rows.roles.variableWidth);assert.equal(rows.roles.primaryWidth,rows.roles.variableWidth);assert.equal(rows.roles.leasePixels,0);
  if(process.env.CODESHELL_OWNED_FONT_EVIDENCE_DIR){const out=process.env.CODESHELL_OWNED_FONT_EVIDENCE_DIR;await mkdir(out,{recursive:true});await writeFile(join(out,"real-font-manager.json"),JSON.stringify({scope:"real CPU Chromium FontFace and Canvas2D; not product/Host/Figma/BFCache acceptance",browser:browser.version(),args:["--disable-gpu"],fonts:{inter:hash(inter),roboto:hash(roboto)},rows},null,2)+"\n");}
});
