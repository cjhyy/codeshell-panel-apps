import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium } from "playwright";
import Ajv from "ajv/dist/2020.js";
import { normalizeShadowStack, validateShadowStack, shadowMaskGeometry, shadowStackOutsets, nativeShadowStackEffects } from "../../../apps/design-studio/app/shadow-stack.mjs";
import { normalizeDesignDocument, serializeDesignDocument, exportDesignSvg } from "../../../apps/design-studio/app/document.mjs";
import { exportDesignFrontend } from "../../../apps/design-studio/app/frontend-export.mjs";
import { createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { compareDesignDocuments } from "../../../apps/design-studio/app/design-compare.mjs";
import { comparePixels } from "../../../scripts/design-studio-production-fidelity.mjs";
const layer = (extra={}) => ({kind:"inner",color:"#dc2626",opacity:1,x:8,y:0,blur:0,spread:0,visible:true,...extra});
const shape = (extra={}) => ({id:"shape",type:"rectangle",name:"Shape",x:0,y:0,width:100,height:80,fill:"#ffffff",stroke:"transparent",strokeWidth:0,opacity:1,rotation:0,cornerRadius:0,visible:true,locked:false,shadowStack:{basis:"css-box",layers:[layer()]},...extra});
const documentFor = node => ({format:"codeshell.design",version:3,name:"Shadow",canvas:{width:640,height:240,background:"#ffffff"},tokens:{colors:[]},resources:[],activePageId:"page",pages:[{id:"page",name:"Page",children:[node]}]});
test("bounded ordered stack codec/schema preserve exact layer values and refuse unsupported admission", async () => {
  const input=documentFor(shape({shadowStack:{basis:"css-box",layers:[layer({opacity:.10196078431372549}),layer({kind:"outer",color:"#2563eb",visible:false})]}}));
  const saved=JSON.parse(serializeDesignDocument(normalizeDesignDocument(input)));
  assert.deepEqual(saved.pages[0].children[0].shadowStack,input.pages[0].children[0].shadowStack);
  const changed=structuredClone(saved);changed.pages[0].children[0].shadowStack.layers.reverse();assert.equal(compareDesignDocuments(saved,changed).passed,false);delete changed.pages[0].children[0].shadowStack;assert.equal(compareDesignDocuments(saved,changed).passed,false);
  const schema=JSON.parse(await readFile(new URL("../../../apps/design-studio/app/formats/codeshell-design-v3.schema.json",import.meta.url)));
  const valid=new Ajv({strict:false}).compile(schema);assert.equal(valid(saved),true,JSON.stringify(valid.errors));
  for(const edit of [n=>n.shadowStack.layers=Array(1),n=>n.shadowStack.layers[0].spread=1,n=>n.shadowStack.layers[0].x=Infinity,n=>n.shadowStack.extra=true,n=>n.shadowStack.basis="native-paint",n=>n.shadowStack.layers.push(...Array.from({length:8},()=>layer())),n=>n.shadow={color:"#000000",opacity:1,x:0,y:0,blur:0},n=>n.type="ellipse"]){const n=structuredClone(input.pages[0].children[0]);edit(n);assert.throws(()=>normalizeDesignDocument(documentFor(n)));}
  assert.equal(valid(documentFor(shape({type:"ellipse"}))),false);
  const manifest=JSON.parse(await readFile(new URL("../../../apps/design-studio/.codeshell-panel/panel.json",import.meta.url))),tool=manifest.agent.tools.find(tool=>tool.name==="use_design"),{validateToolArgsStrict}=await import("@cjhyy/code-shell-core");
  const request={expected_state_revision:"shadow",operations:[{op:"update_node",node_id:"shape",changes:{shadowStack:input.pages[0].children[0].shadowStack}}]};assert.equal(validateToolArgsStrict("use_design",request,tool.inputSchema),null);
  request.operations[0].changes.shadowStack.layers[0].spread=1;assert.notEqual(validateToolArgsStrict("use_design",request,tool.inputSchema),null);
  assert.throws(()=>validateShadowStack(shape({stroke:"#000000",strokeWidth:1})),/inside/);
  assert.throws(()=>validateShadowStack(shape({cornerRadius:20,strokeAlign:"inside",strokeWidth:1,stroke:"#000000"})),/圆角/);
});
test("mask geometry follows border edges rather than authored content padding, and only outer layers expand bounds",()=>{
  const n=shape({strokeAlign:"inside",strokeSides:[1,2,3,4].map(width=>({width,color:"#000000",opacity:.5})),paddingTop:30,paddingLeft:40});
  assert.deepEqual(shadowMaskGeometry(n).inner,{x:4,y:1,width:94,height:76});
  assert.deepEqual(shadowStackOutsets(n),{left:0,top:0,right:0,bottom:0});
  n.shadowStack.layers.push(layer({kind:"outer",x:-12,y:4,blur:8}));
  assert.deepEqual(shadowStackOutsets(n),{left:24,top:12,right:12,bottom:16});
  assert.equal(shadowStackOutsets(n,30).left,12+Math.hypot(12,4));
});
test("native preflight refuses the complete Header mask and preserves editable borderless opaque Cover intent with warning",()=>{
  const cover=shape({shadowStack:{basis:"css-box",layers:[layer({color:"#000000",opacity:.5,x:0,blur:80})]}});
  assert.equal(nativeShadowStackEffects(cover)[0].type,"INNER_SHADOW");
  assert.equal(createFigmaTransfer(documentFor(cover)).warnings.some(w=>w.code==="css-shadow-native-raster"),true);
  for(const n of [shape({fill:"transparent"}),shape({fillPaints:[{type:"SOLID",color:"#ffffff",opacity:.1}]}),shape({strokeAlign:"inside",strokeWidth:1,stroke:"#000000"}),shape({shadowStack:{basis:"css-box",layers:[layer({kind:"outer"})]}}),shape({shadowStack:{basis:"css-box",layers:[layer(),layer({color:"#2563eb"})]}})])assert.throws(()=>createFigmaTransfer(documentFor(n)),/阴影/);
});
test("actual production CSS capture retains all layers; direct frontend resize and zero-blur SVG honor order, masks and borders",async t=>{
  const browser=await chromium.launch({args:["--disable-gpu"]});t.after(()=>browser.close());const page=await browser.newPage({deviceScaleFactor:1});
  const app=fileURLToPath(new URL("../../../apps/design-studio/app/",import.meta.url));
  await page.route("**/*",async route=>{const u=new URL(route.request().url());if(u.href==="https://shadow.test/")return route.fulfill({contentType:"text/html",body:"<!doctype html>"});if(u.origin==="https://shadow.test"&&u.pathname.startsWith("/app/")&&u.pathname.endsWith(".mjs"))return route.fulfill({contentType:"text/javascript",body:await readFile(join(app,u.pathname.slice(5)))});return route.abort();});await page.goto("https://shadow.test/");
  const cases=[
    {fill:"white",border:"0",shadow:"inset 8px 0 0 #dc2626,inset 0 8px 0 #2563eb"},
    {fill:"transparent",border:"1px solid #16a34a",shadow:"inset 8px 0 0 #dc2626,inset 0 8px 0 #2563eb"},
    {fill:"white",border:"0",shadow:"8px 8px 0 #dc2626,inset 0 8px 0 #2563eb"},
    {fill:"linear-gradient(90deg,#f97316 50%,#22c55e 50%)",border:"0",shadow:"8px 8px 0 #dc2626,inset 0 8px 0 #2563eb"},
    {fill:"rgba(0,0,0,.1)",border:"1px solid rgba(0,0,0,.15)",shadow:"inset 0 8px 24px rgba(0,0,0,.1),inset 0 2px 8px rgba(0,0,0,.15)",kernel:true},
    {fill:"#212529",border:"0",shadow:"inset 0 0 80px rgba(0,0,0,.5)",kernel:true},
  ];
  for(const c of cases){const html=`<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;background:white}main{display:flex;width:100%;height:240px;padding:20px}section{flex:1;height:100px;background:${c.fill};border:${c.border};box-shadow:${c.shadow}}</style><main><section></section></main>`;
    await page.setViewportSize({width:640,height:240});const capture=await page.evaluate(async html=>{const{captureWorkspaceHtmlResult}=await import('/app/html-import.mjs');return captureWorkspaceHtmlResult({html,sourcePath:'shadow.html',readText:async()=>'',rootSelector:'body',viewportWidth:640,viewportHeight:240});},html);
    const state=normalizeDesignDocument(capture.document),n=state.nodes.find(node=>node.shadowStack);assert(n);assert.equal(n.shadowStack.layers.length,c.shadow.split(/,(?![^()]*\))/u).length);assert.equal(n.shadow,undefined);
    const reopened=normalizeDesignDocument(JSON.parse(serializeDesignDocument(state)));assert.deepEqual(reopened.nodes.map(n=>[n.id,n.x,n.y,n.width,n.height]),state.nodes.map(n=>[n.id,n.x,n.y,n.width,n.height]));
    assert.equal(capture.report.warnings.some(w=>w.code==="shadow-approximation"),false);
    const output=exportDesignFrontend(reopened);
    for(const width of [640,400,640]){await page.setViewportSize({width,height:240});await page.setContent(html);const reference=await page.screenshot();await page.setContent(output);await page.locator('[data-codeshell-id="html-viewport"]').evaluate((el,width)=>el.style.width=`${width}px`,width);const front=comparePixels(reference,await page.screenshot());if(front.metrics.changedPixels)t.diagnostic(JSON.stringify({node:n,front:front.metrics,css:await page.locator(`[data-codeshell-id="${n.id}"]`).getAttribute("style")}));assert.equal(front.metrics.changedPixels,0,`frontend ${c.shadow}/${width}`);
      reopened.nodes.find(n=>n.id==="html-viewport").width=width;reopened.canvas.width=width;applyAllAutoLayouts(reopened.nodes);const svg=exportDesignSvg(normalizeDesignDocument(JSON.parse(serializeDesignDocument(reopened))));
      {await page.setContent(`<style>html,body{margin:0}svg{display:block}</style>${svg}`);const compared=comparePixels(reference,await page.screenshot());if(!c.kernel)assert.equal(compared.metrics.changedPixels,0,`SVG ${c.shadow}`);else {assert.equal(capture.report.warnings.some(w=>w.code==="shadow-raster-kernel"),true);t.diagnostic(JSON.stringify({shadow:c.shadow,svgStrictPixels:compared.metrics}));}}
    }
  }
});
