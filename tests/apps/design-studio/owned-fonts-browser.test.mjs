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
    assert.equal(url.pathname,"/owned-fonts.mjs");
    return route.fulfill({body:await readFile(resolve(app,"owned-fonts.mjs")),contentType:"text/javascript"});
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
    const set=async resources=>{const token=manager.begin(),prepared=await manager.prepare(token,resources);manager.commit(token,prepared);};
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
  if(process.env.CODESHELL_OWNED_FONT_EVIDENCE_DIR){const out=process.env.CODESHELL_OWNED_FONT_EVIDENCE_DIR;await mkdir(out,{recursive:true});await writeFile(join(out,"real-font-manager.json"),JSON.stringify({scope:"real CPU Chromium FontFace and Canvas2D; not product/Host/Figma/BFCache acceptance",browser:browser.version(),args:["--disable-gpu"],fonts:{inter:hash(inter),roboto:hash(roboto)},rows},null,2)+"\n");}
});
