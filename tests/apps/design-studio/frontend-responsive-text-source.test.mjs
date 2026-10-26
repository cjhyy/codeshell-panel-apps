import { settleLoadedFont, recordFontPixelMismatch, loadedFontBrowserArgs } from "./fixtures/loaded-font.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { normalizeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";
const original="An editable table cell wraps its original sentence when the available width changes.\n  An authored second line keeps  two spaces.";
const expanded=original+"\nGamma\nDelta";
const common={stroke:"transparent",strokeWidth:0,opacity:1,rotation:0,cornerRadius:0,visible:true,locked:false};

test("frontend wrap uses authored text without cached soft breaks through real DOM width and copy edits",async(t)=>{
  const {chromium}=await import("playwright"),{PNG}=await import("pngjs");
  const browser=await chromium.launch({args:loadedFontBrowserArgs()});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:760,height:350},deviceScaleFactor:1});
  const page=await context.newPage(),reference=await context.newPage();
  const font=await readFile(new URL("../../../apps/design-studio/app/fonts/InterVariable.woff2",import.meta.url));
  const fontCss=`@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font.toString("base64")}) format('woff2');font-weight:100 900;font-style:normal;font-display:block}`;
  const value=normalizeDesignDocument({format:"codeshell.design",version:3,name:"Responsive authored text",tokens:{colors:[]},resources:[],activePageId:"page",canvas:{width:760,height:350,background:"#ffffff"},pages:[{id:"page",name:"Page",children:[{...common,gap:0,padding:0,alignItems:"start",justifyContent:"start",id:"owner",type:"frame",name:"Owner",x:20,y:20,width:630,height:120,fill:"#e2e8f0",layout:"vertical",layoutSizingVertical:"hug",children:[{...common,textAlign:"left",id:"copy",type:"text",name:"Editable copy",x:20,y:20,width:630,height:120,fill:"#334155",text:"An editable table cell \nwraps its original \nsentence when the \navailable width changes.\n  An authored second line keeps  two spaces.",textSource:original,textFlow:"wrap",fontFamily:"Inter",fontSize:16,fontWeight:400,lineHeight:1.25,layoutSizingHorizontal:"fill",layoutSizingVertical:"hug"}]}]}]});
  const html=exportDesignFrontend(value).replace("<head>",`<head><style>${fontCss}</style>`);
  await page.setContent(html);await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('[data-codeshell-source-id="copy"]').textContent(),original,"authored LF/space bytes retained while only cached soft breaks disappear");
  for(const [width,copy] of [[630,original],[390,original],[630,original],[630,expanded],[390,expanded],[390,original],[630,original]]){
    await page.locator('[data-codeshell-source-id="owner"]').evaluate((node,width)=>{node.style.width=`${width}px`;},width);
    await page.locator('[data-codeshell-source-id="copy"]').evaluate((node,copy)=>{node.textContent=copy;},copy);
    await reference.setContent(`<!doctype html><style>${fontCss}html,body{margin:0;background:white}.owner{position:absolute;left:20px;top:20px;width:${width}px;background:#e2e8f0;display:flex;flex-direction:column}.copy{width:100%;font:400 16px/20px Inter;color:#334155;white-space:pre-wrap;overflow-wrap:anywhere}</style><div class="owner"><div class="copy"></div></div>`);
    await reference.locator('.copy').evaluate((node,copy)=>{node.textContent=copy;},copy);
    await Promise.all([settleLoadedFont(page),settleLoadedFont(reference)]);
    const actualBytes=await page.screenshot(),expectedBytes=await reference.screenshot();
    await recordFontPixelMismatch(page,reference,actualBytes,expectedBytes,`authored-wrap-${width}-${copy.length}`);
    const actual=PNG.sync.read(actualBytes),expected=PNG.sync.read(expectedBytes);
    assert(actual.data.equals(expected.data),`${width}/${JSON.stringify(copy)} strict pixels after direct DOM edit`);
    assert.equal(await page.locator('[data-codeshell-source-id="copy"]').textContent(),copy);
  }
});
