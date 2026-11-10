import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { geometryDifference, inkGeometry, shapeGeometryFailures, shapePixelQualification } from "./render-fidelity.metrics.mjs";

const app = resolve("apps/design-studio/app"), origin = "https://flow-paint-box.test";
const base = (id,type,x,y,width,height,extra={}) => ({id,type,name:id,x,y,width,height,fill:"#111111",stroke:"transparent",strokeWidth:0,opacity:1,rotation:0,cornerRadius:0,visible:true,...extra});
const evidence = resolve(process.env.DESIGN_FLOW_BOX_EVIDENCE ?? ".tmp/render-fidelity-r005/flow-box");

for (const {dpr,zoom} of [{dpr:1,zoom:1},{dpr:2,zoom:1},{dpr:1,zoom:2},{dpr:2,zoom:2}])
test(`materialized flex/hug/fill boxes follow browser paint at DPR ${dpr}, zoom ${zoom}`, async t => {
  const browser = await chromium.launch({args:process.platform === "darwin" ? ["--use-angle=metal"] : ["--enable-webgl","--enable-unsafe-swiftshader"]});
  t.after(() => browser.close());
  const context = await browser.newContext({viewport:{width:1000,height:700},deviceScaleFactor:dpr});
  const page = await context.newPage(), errors = [], blocked = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { blocked.push(url.href); return route.abort(); }
    if (url.pathname === "/") return route.fulfill({contentType:"text/html",body:'<!doctype html><body style="margin:0;background:white"><canvas></canvas></body>'});
    const file = resolve(app,`.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(app + sep)) return route.abort();
    try { return route.fulfill({body:await readFile(file),contentType:{".mjs":"text/javascript",".js":"text/javascript",".wasm":"application/wasm",".ttf":"font/ttf",".woff2":"font/woff2"}[extname(file)]}); }
    catch { return route.fulfill({status:404,body:"missing local fixture asset"}); }
  });
  await page.goto(origin);
  const design = await page.evaluate(async baseSource => {
    const base = (0,eval)(`(${baseSource})`), nodes = [];
    const {applyAllAutoLayouts} = await import("/layout.mjs");
    for (const [row,layout] of ["horizontal","vertical"].entries()) for (const [column,alignment] of ["start","center","end"].entries()) {
      const id = `${layout}-${alignment}`, x = 20.35 + column * 155, y = 20.35 + row * 150;
      nodes.push(base(id,"frame",x,y,145.73,135.85,{layout,padding:3.17,gap:4.23,alignItems:alignment,justifyContent:alignment,fill:"transparent"}));
      nodes.push(base(`${id}-hug`,"frame",x,y,55,20,{parentId:id,layout:"horizontal",layoutSizingHorizontal:"hug",layoutSizingVertical:"hug",padding:1.35,gap:2.15,alignItems:"center",justifyContent:"start",fill:"transparent"}));
      nodes.push(base(`${id}-text`,"text",x,y,32,15,{parentId:`${id}-hug`,text:"HMI",textSource:"HMI",fontFamily:"Arial",fontSize:12,fontWeight:400,lineHeight:1.2,textAlign:"left",layoutSizingHorizontal:"hug"}));
      nodes.push(base(`${id}-icon`,"frame",x,y,9.85,9.85,{parentId:`${id}-hug`,layout:"none",fill:"transparent"}));
      nodes.push(base(`${id}-thin`,"rectangle",x+4.35,y+1.15,1.17,7.37,{parentId:`${id}-icon`}));
      nodes.push(base(`${id}-fill`,"rectangle",x,y,12.73,12.73,{parentId:id,[layout === "horizontal" ? "layoutSizingVertical" : "layoutSizingHorizontal"]:"fill",fill:"#2244aa"}));
    }
    applyAllAutoLayouts(nodes);
    return {format:"codeshell.design",version:3,name:"Materialized flex spike",canvas:{width:500,height:350,background:"#ffffff"},resources:[],nodes,activePageId:"main",pages:[{id:"main",name:"Main",nodes}]};
  },base.toString());
  const source = JSON.stringify(design), output = resolve(evidence,`dpr${dpr}-zoom${zoom}`);
  await mkdir(output,{recursive:true});
  await writeFile(resolve(output,"source.json"),source);
  const stats = await page.evaluate(async ({design,dpr,zoom}) => {
    const {createRenderer} = await import("/canvas/canvaskit-renderer.mjs");
    window.renderer = await createRenderer({canvas:document.querySelector("canvas"),assetsBaseUrl:"/canvas/vendor/",tileCacheEnabled:false,background:"#ffffff"});
    renderer.resize(1000,700,dpr); await renderer.setScene(design); renderer.render({zoom});
    return renderer.stats();
  },{design,dpr,zoom});
  const actual = PNG.sync.read(await page.screenshot({path:resolve(output,"gpu.png"),scale:"device"}));
  const layout = await page.evaluate(async ({design,zoom}) => {
    const {renderDesignFrontendPage,designFrontendCss} = await import("/frontend-export.mjs");
    document.querySelector("canvas").style.visibility = "hidden";
    const wrapper = document.createElement("div");
    wrapper.style.cssText = `position:absolute;left:0;top:0;width:500px;height:350px;transform-origin:0 0;transform:scale(${zoom})`;
    wrapper.innerHTML = `<style>${designFrontendCss(design)}.cs-page{margin:0!important}</style>${renderDesignFrontendPage(design)}`;
    document.body.append(wrapper);
    const {browserPaintBoxes} = await import("/canvas/browser-paint-box.mjs");
    const replay = browserPaintBoxes(design.nodes);
    return design.nodes.map(node => {
      const element = wrapper.querySelector(`[data-codeshell-id="${node.id}"]`), rect = element.getBoundingClientRect();
      const box = {x:rect.x/zoom,y:rect.y/zoom,width:rect.width/zoom,height:rect.height/zoom};
      const delta = Object.fromEntries(Object.entries(box).map(([key,value]) => [key,value-node[key]]));
      const replayBox = replay.layoutBoxes.get(node.id);
      return {id:node.id,replay:replayBox,saved:{x:node.x,y:node.y,width:node.width,height:node.height},box,delta,reason:Object.keys(box).some(key => box[key] !== replayBox[key]) ? "LAYOUT_MISMATCH" : null};
    });
  },{design,zoom});
  const expected = PNG.sync.read(await page.screenshot({path:resolve(output,"html.png"),scale:"device"}));
  const scale = dpr*zoom;
  const rows = design.nodes.filter(node => /-(thin|fill)$/.test(node.id)).map(node => {
    // The narrow line's ROI excludes its neighboring HMI label. The complete
    // scene remains in both images, with the same ancestor layout and opacity.
    const margin = node.id.endsWith("-thin") ? .6 : 1;
    const roi = {x:(node.x-margin)*scale,y:(node.y-margin)*scale,width:(node.width+2*margin)*scale,height:(node.height+2*margin)*scale};
    const foreground = node.id.endsWith("-fill") ? [34,68,170] : [17,17,17];
    const delta = geometryDifference(inkGeometry(expected,{roi,foreground}),inkGeometry(actual,{roi,foreground}));
    const failures = shapeGeometryFailures(delta);
    return {id:node.id,roi,delta,failures,pixel:shapePixelQualification(expected,actual,{roi,geometryPassed:failures.length === 0})};
  });
  await writeFile(resolve(output,"metrics.json"),JSON.stringify({dpr,zoom,layout,rows,stats,errors,blocked},null,2));
  assert.equal(JSON.stringify(design),source,"paint never edits saved layout coordinates");
  assert.deepEqual(errors,[]); assert.deepEqual(blocked,[]);
  assert.deepEqual(layout.filter(row => row.reason),[],"presentation replay must exactly agree with all 36 DOM boxes");
  assert.deepEqual(rows.filter(row => row.failures.length),[],"flow thin/fill geometry must pass strict shape thresholds");
  assert.deepEqual(rows.filter(row => !row.pixel.rawPass && !row.pixel.qualified),[],"flow thin/fill pixels must pass raw or qualified AA thresholds");
});
