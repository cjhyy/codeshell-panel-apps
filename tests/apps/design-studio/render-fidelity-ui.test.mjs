import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { fidelityFontOmissions, renderFidelityFixture } from "./render-fidelity.fixture.mjs";
import { FIDELITY_THRESHOLDS, geometryDifference, inkGeometry, parseRgb, strokeScan, symmetricPixelDifference, textGeometryFailures } from "./render-fidelity.metrics.mjs";
import { compareGeometryProbe } from "./render-fidelity-geometry.mjs";

// The baseline directory must be an exact git archive. Both Node exports and
// browser modules are resolved there: a mixed old/new renderer is not a baseline.
const app = resolve(process.env.DESIGN_FIDELITY_APP_DIR ?? "apps/design-studio/app");
const load = name => import(pathToFileURL(join(app, name)));
const { normalizeDesignDocument, serializeDesignDocument, designPageBounds } = await load("document.mjs");
const { renderDesignFrontendPage, designFrontendCss } = await load("frontend-export.mjs");
const { designFontFaceCss } = await load("font-css.mjs");
const { textRangeSourceSignature } = await load("text-ranges.mjs");
const { createDesignResourcePersistencePlan } = await load("resource-store.mjs");
const { createDesignIndexPersistencePlan } = await load("document-index.mjs");
const { applyAllAutoLayouts } = await load("layout.mjs");
const origin = "https://render-fidelity.test", sourcePath = "designs/render-fidelity.codesign.json";
const output = resolve(process.env.DESIGN_FIDELITY_EVIDENCE ?? ".tmp/render-fidelity-r001/current");
const diagnostic = process.env.DESIGN_FIDELITY_MODE === "diagnostic";
const hash = value => createHash("sha256").update(typeof value === "string" || ArrayBuffer.isView(value) ? value : JSON.stringify(value)).digest("hex");
const matrix = [ {id:"dpr1-zoom1",dpr:1,zoom:1}, {id:"dpr2-zoom1",dpr:2,zoom:1}, {id:"dpr1-zoom2",dpr:1,zoom:2}, {id:"dpr1-zoom05",dpr:1,zoom:.5} ]
  .filter(item => !process.env.DESIGN_FIDELITY_MATRIX || process.env.DESIGN_FIDELITY_MATRIX.split(",").includes(item.id));
const frames = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));

async function dataset() {
  const parts = [], dataUrls = new Map(); let design, inputHash = null, real = false;
  if (process.env.DESIGN_FIDELITY_REAL_FIXTURE) {
    real = true;
    const bytes = await readFile(process.env.DESIGN_FIDELITY_REAL_FIXTURE), portable = JSON.parse(bytes);
    inputHash = hash(bytes); design = normalizeDesignDocument(portable.document);
    const descriptors = new Map(design.resources.map(resource => [resource.id,resource]));
    for (const resource of portable.resources ?? []) {
      const descriptor = descriptors.get(resource.id); assert(descriptor,"portable asset must have descriptor");
      const plan = await createDesignResourcePersistencePlan({...descriptor,base64:resource.base64,sha256Bytes:hash});
      assert.deepEqual(plan.descriptor,descriptor); parts.push(...plan.parts);
      dataUrls.set(resource.id,`data:${descriptor.mime};base64,${resource.base64}`);
    }
  } else {
    const source = renderFidelityFixture({textRangeSourceSignature});
    const bytes = await readFile(join(app,"fonts/InterVariable.woff2"));
    const plan = await createDesignResourcePersistencePlan({id:"fidelity-inter",kind:"font",mime:"font/woff2",base64:bytes.toString("base64"),family:"Fidelity Inter",weight:400,style:"normal",sha256Bytes:hash});
    source.resources.push(plan.descriptor); design = normalizeDesignDocument(source); parts.push(...plan.parts);
    dataUrls.set(plan.descriptor.id,`data:font/woff2;base64,${bytes.toString("base64")}`);
    // Author the synthetic source in its canonical layout once. Every route
    // then receives these same coordinates, including the fake Host's GPU path.
    for(const page of design.pages)applyAllAutoLayouts(page.nodes);
  }
  const serialized = serializeDesignDocument(design);
  assert.equal(serializeDesignDocument(normalizeDesignDocument(JSON.parse(serialized))),serialized,"opening/serializing without edits is stable");
  const indexPlan = await createDesignIndexPersistencePlan({document:design,sha256:hash});
  return {design,parts:[...parts,...indexPlan.parts],source:indexPlan.primarySource,dataUrls,real,inputHash,serializedHash:hash(serialized)};
}

async function editor(browser, item, data) {
  const context = await browser.newContext({viewport:{width:1600,height:1000},deviceScaleFactor:item.dpr});
  const page = await context.newPage(), files = new Map([[sourcePath,data.source],...data.parts.map(part=>[part.path,part.content])]);
  const records = new Map(), errors = [], blocked = [], calls = [], routes = new Map();
  page.setDefaultTimeout(20000); page.on("pageerror",error=>errors.push(error.message));
  await context.route("**/*",async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin){blocked.push(url.href);return route.abort();}
    if(routes.has(url.pathname))return route.fulfill({contentType:"text/html",body:routes.get(url.pathname)});
    const file=resolve(app,`.${decodeURIComponent(url.pathname)}`);
    if(!file.startsWith(app+sep)){blocked.push(url.href);return route.abort();}
    try{
      let body=await readFile(file);
      if(url.pathname==="/canvas/canvaskit-renderer.mjs") {
        // Read-only test hook. This does not alter scenes, drawing or cache keys.
        const marker="return { setScene, resize, render, dispose, stats };";
        assert(body.toString().includes(marker),"renderer stats hook remains anchored");
        body=Buffer.from(body.toString().replace(marker,`globalThis.__fidelityGpuStats = stats; ${marker}`));
      }
      return route.fulfill({body,contentType:{".html":"text/html",".js":"text/javascript",".mjs":"text/javascript",".css":"text/css",".wasm":"application/wasm",".woff2":"font/woff2",".ttf":"font/ttf"}[extname(file)]});
    }catch(error){return route.fulfill({status:404,body:"fixture missing file"});}
  });
  await page.exposeFunction("hostBridge",async(method,params={})=>{
    calls.push({method,path:params.path,key:params.key});
    const snapshot=()=>({exists:records.has(params.key),value:records.get(params.key)??null,revision:records.has(params.key)?hash(records.get(params.key)):null});
    if(method==="workspace.info")return{root:"/render-fixture",cwd:"/render-fixture",name:"Read-only fidelity fixture"};
    if(method==="workspace.list")return{entries:[],truncated:false};
    if(method==="workspace.readText"){if(!files.has(params.path))throw Error("ENOENT");return{content:files.get(params.path),modifiedAt:1,revision:hash(files.get(params.path))};}
    if(method==="workspace.writeText")throw Error("Fidelity fixture source is immutable");
    if(method==="storage.get")return params.key.startsWith("lastPath.")?{workspaceRoot:"/render-fixture",path:sourcePath}:records.get(params.key)??null;
    if(method==="storage.set"){records.set(params.key,structuredClone(params.value));return null;}
    if(method==="storage.delete"){records.delete(params.key);return null;}
    if(method==="storage.getSnapshot")return snapshot();
    if(method==="storage.compareAndSet"){if(params.expectedRevision!==snapshot().revision)return{updated:false,snapshot:snapshot()};if(params.remove)records.delete(params.key);else records.set(params.key,structuredClone(params.value));return{updated:true,snapshot:snapshot()};}
    throw Error(`Unsupported fake Host method ${method}`);
  });
  await page.addInitScript(()=>{
    window.tools={}; window.codeshellPanel={getContext:async()=>({trusted:true,busy:false,cwd:"/render-fixture",sessionId:"render-fixture",capabilities:{packageAssets:{wasm:true,fetch:"package"}},availableMethods:["workspace.info","workspace.list","workspace.readText","workspace.writeText","storage.get","storage.set","storage.delete","storage.getSnapshot","storage.compareAndSet"]}),on(){},registerTool(name,callback){window.tools[name]=callback;},call:(method,params)=>window.hostBridge(method,params)};
  });
  await page.goto(`${origin}/index.html`);
  await page.waitForFunction(async name=>!document.querySelector(".workspace").inert && Boolean(window.tools.get_design_metadata) && (await tools.get_design_metadata({})).name===name,data.design.name);
  if(await page.locator("#toggle-grid").getAttribute("aria-pressed")==="true")await page.locator("#toggle-grid").click();
  return {context,page,routes,calls,errors,blocked};
}
async function rendererReady(page,mode) {
  await page.waitForFunction(mode=>{
    const data=document.querySelector("#stage-wrap").dataset;
    return data[mode==="gpu"?"gpuActive":"browserActive"]==="true" || ["error","unavailable"].includes(data.rendererStatus);
  },mode);
  const state=await page.locator("#stage-wrap").evaluate(element=>({...element.dataset}));
  if(state[mode==="gpu"?"gpuActive":"browserActive"]!=="true")throw Error(await page.locator("#renderer-state").getAttribute("title"));
  await frames(page);
}
async function align(page,tile,zoom) {
  const view=await page.locator("#stage").evaluate(async(canvas,{tile,zoom})=>{
    const frame=()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))), current=()=>canvas.getContext("2d").getTransform(),box=canvas.getBoundingClientRect();
    canvas.dispatchEvent(new WheelEvent("wheel",{ctrlKey:true,deltaY:Math.log(current().a/devicePixelRatio/zoom)/.006,clientX:box.left,clientY:box.top,bubbles:true,cancelable:true}));await frame();
    for(let i=0;i<8;i++){
      const matrix=current(),targetX=32-tile.x*zoom,targetY=32-tile.y*zoom;
      if(matrix.e/devicePixelRatio===targetX&&matrix.f/devicePixelRatio===targetY)break;
      canvas.dispatchEvent(new WheelEvent("wheel",{deltaX:matrix.e/devicePixelRatio-targetX,deltaY:matrix.f/devicePixelRatio-targetY,bubbles:true,cancelable:true}));await frame();
    }
    const matrix=current();return{zoom:matrix.a/devicePixelRatio,panX:matrix.e/devicePixelRatio,panY:matrix.f/devicePixelRatio,left:box.left,top:box.top};
  },{tile,zoom});
  assert(Math.abs(view.zoom-zoom)<.00001,JSON.stringify(view));
  assert(Math.abs(view.panX-(32-tile.x*zoom))<.01&&Math.abs(view.panY-(32-tile.y*zoom))<.01,JSON.stringify(view));
  return view;
}
function tiles(bounds,zoom) {
  const width=Math.min(bounds.width,1536/zoom),height=Math.min(bounds.height,936/zoom),result=[];
  for(let y=bounds.y;;y+=Math.max(1,height-48/zoom)){
    for(let x=bounds.x;;x+=Math.max(1,width-48/zoom)){
      const tile={x:Math.min(x,bounds.x+bounds.width-width),y:Math.min(y,bounds.y+bounds.height-height),width,height};
      if(!result.some(prior=>prior.x===tile.x&&prior.y===tile.y))result.push(tile);
      if(x+width>=bounds.x+bounds.width)break;
    }
    if(y+height>=bounds.y+bounds.height)break;
  }
  return result;
}
function crop(png,roi) {
  const x=Math.max(0,Math.floor(roi.x)),y=Math.max(0,Math.floor(roi.y)),width=Math.min(png.width-x,Math.ceil(roi.width)),height=Math.min(png.height-y,Math.ceil(roi.height));
  const result=new PNG({width,height});PNG.bitblt(png,result,x,y,width,height,0,0);return PNG.sync.write(result);
}
function backgroundFor(node,nodes,canvas) {
  const index=new Map(nodes.map(entry=>[entry.id,entry]));
  for(let parent=index.get(node.parentId),seen=new Set();parent&&!seen.has(parent.id);parent=index.get(parent.parentId)){
    seen.add(parent.id);if(parent.fillPaints?.some(paint=>paint.type!=="SOLID"))return null;
    const color=parseRgb(parent.fill);if(color)return color;
  }
  return parseRgb(canvas.background)??[255,255,255];
}
function compareNodes(images,nodes,tile,item,canvas,real) {
  const scale=item.dpr*item.zoom,rows=[];
  for(const node of nodes){
    if(node.visible===false||!(node.type==="text"||node.strokeWidth>0||node.strokeSides||["radius","rotation","shadow","shadow-stack","opacity","button-edge","selector-edge","clipped-child"].includes(node.id)))continue;
    // Tile overlaps cover edges; each report lists incompletely visible nodes.
    const inset=8,complete=node.x-inset>=tile.x&&node.y-inset>=tile.y&&node.x+node.width+inset<=tile.x+tile.width&&node.y+node.height+inset<=tile.y+tile.height;
    if(node.x+node.width<=tile.x||node.x>=tile.x+tile.width||node.y+node.height<=tile.y||node.y>=tile.y+tile.height)continue;
    const left=Math.max(node.x-inset,tile.x),top=Math.max(node.y-inset,tile.y),right=Math.min(node.x+node.width+inset,tile.x+tile.width),bottom=Math.min(node.y+node.height+inset,tile.y+tile.height);
    const roi={x:(left-tile.x)*scale,y:(top-tile.y)*scale,width:(right-left)*scale,height:(bottom-top)*scale};
    const background=backgroundFor(node,nodes,canvas);
    let foreground=parseRgb(node.type==="text"||!(node.strokeWidth>0)?node.fill:node.stroke);
    if(node.type==="text"&&node.strokeWidth>0&&foreground&&background&&foreground.every((v,i)=>v===background[i]))foreground=parseRgb(node.stroke);
    const diagnosticReasons=[];
    if(!complete)diagnosticReasons.push("partial node box in tile: visible segment only; not a whole-node geometry pass");
    if(Number.isFinite(node.layoutBaselineOffset))diagnosticReasons.push("finite offset: compatibility is baseline PNG/SVG equality, not HTML parity");
    if(node.rotation)diagnosticReasons.push("rotated ROI: bbox is diagnostic; oriented geometry pending");
    if(!foreground||!background||foreground.every((v,i)=>v===background[i]))diagnosticReasons.push("foreground/background cannot be isolated");
    if(node.opacity!==1)diagnosticReasons.push("opacity-weighted ink centroid diagnostic");
    const measurements={};
    for(const [route,image] of Object.entries(images)){
      const pixel=symmetricPixelDifference(images.html,image,{roi});
      const foregrounds=[foreground,...(node.textRanges?.ranges??[]).map(range=>parseRgb(range.fill))].filter(Boolean);
      const ink=foreground&&background?inkGeometry(image,{roi,foreground,foregrounds,background}):null;
      measurements[route]={ink,pixel,cropSha256:hash(crop(image,roi))};
      measurements[route].geometryProbe=compareGeometryProbe(images.html,image,{node,tile,scale});
      if(node.strokeWidth>0&&node.type!=="text"&&!node.rotation){
        const options={x:(node.x+node.width/2-tile.x)*scale,y:(node.y-tile.y)*scale,halfWindow:Math.ceil((node.strokeWidth+4)*scale),average:5,foreground:parseRgb(node.stroke)??[0,0,0],background:parseRgb(node.fill)??background??[255,255,255]};
        measurements[route].stroke=strokeScan(image,options);
      }
    }
    for(const [route,value]of Object.entries(measurements)){
      value.delta=geometryDifference(measurements.html.ink,value.ink);value.failures=[];
      if(value.geometryProbe)value.failures.push(...value.geometryProbe.failures);
      value.primaryAvailable=value.geometryProbe?value.geometryProbe.measurable:node.type==="text"?Boolean(value.ink):node.strokeWidth>0?Boolean(value.stroke):Boolean(value.ink);
      if(node.type==="text"&&!diagnosticReasons.length)value.failures.push(...textGeometryFailures(value.delta,{scale,align:node.textAlign,centroid:!/[gjpqy]/u.test(node.text??"")}));
      if(value.stroke&&measurements.html.stroke){value.strokeDelta={centroid:value.stroke.centroid-measurements.html.stroke.centroid,width:value.stroke.width-measurements.html.stroke.width};
        if(Math.abs(value.strokeDelta.centroid)>.35)value.failures.push(`stroke centroid ${value.strokeDelta.centroid} > .35`);
        if(Math.abs(value.strokeDelta.width)>.35)value.failures.push(`stroke width ${value.strokeDelta.width} > .35`);
      }
      if(["button-edge","selector-edge"].includes(node.id)&&value.delta.measurable)for(const edge of ["left","top","right","bottom"])if(Math.abs(value.delta[edge])>.5)value.failures.push(`child ${edge} ${value.delta[edge]} > .5`);
      const maximum=node.type==="text"?.005:.001;
      if(value.pixel.mismatchRatio>maximum)value.failures.push(`pixel mismatch ${value.pixel.mismatchRatio} > ${maximum}`);
      if(value.pixel.largestCluster>6)value.failures.push(`pixel cluster ${value.pixel.largestCluster} > 6`);
      // Half zoom is deliberately a coarse secondary-only gate. The unrelaxed
      // geometry is still reported; do not call this a primary-threshold pass.
      value.gating=item.zoom===.5?"coarse-secondary":diagnosticReasons.length&&!value.geometryProbe?.measurable?"diagnostic":"primary-and-secondary";
      value.gateFailures=value.gating==="diagnostic"?[]:value.gating==="coarse-secondary"?value.failures.filter(reason=>reason.startsWith("pixel")):value.failures;
    }
    rows.push({id:node.id,type:node.type,complete,geometry:{x:node.x,y:node.y,width:node.width,height:node.height},diagnosticReasons,measurements});
  }
  return rows;
}

test("B0 four-route actual-editor fidelity matrix (strict by default)",{timeout:900000},async t=>{
  await mkdir(output,{recursive:true}); const data=await dataset(),report={schema:1,mode:diagnostic?"diagnostic":"strict",sourceApp:app,real:data.real,inputSha256:data.inputHash,serializedSha256:data.serializedHash,thresholds:FIDELITY_THRESHOLDS,matrix,viewport:{width:1600,height:1000},launchArgs:["--enable-webgl","--enable-unsafe-swiftshader","--use-angle=swiftshader"],records:[],failures:[],unmeasured:[],partialNodes:[],finiteCompatibility:[],fontAvailability:[],fontOmissions:[],environment:{platform:process.platform,arch:process.arch,node:process.version}};
  const browser=await chromium.launch({headless:true,args:report.launchArgs});report.environment.chromium=browser.version();
  try{
    for(const item of matrix){
      const f=await editor(browser,item,data),page=f.page;
      try{
        const fonts=await page.evaluate(async()=>{await document.fonts.ready;const ctx=document.createElement("canvas").getContext("2d"),sample="HMI 中文 AV";const width=family=>{ctx.font=`20px ${family}`;return ctx.measureText(sample).width;};return Promise.all(["Arial","PingFang SC","system-ui","Fidelity Inter"].map(async family=>{let localFace=false,localName=null;for(const name of [family,...(family==="PingFang SC"?["PingFangSC-Regular"]:[])])try{await new FontFace("AvailabilityProbe",`local("${name}")`).load();localFace=true;localName=name;break;}catch{}return{family,fontCheck:document.fonts.check(`20px "${family}"`),localFace,localName,width:width(`"${family}",monospace`),fallbackWidth:width("monospace"),available:family==="system-ui"||localFace};}));});
        for(const font of fonts)if(data.design.resources.some(resource=>resource.kind==="font"&&resource.family===font.family)){font.resourceProvided=true;font.available=true;}
        report.fontAvailability.push({matrix:item.id,fonts});
        report.fontOmissions.push(...fidelityFontOmissions(fonts,data.design.pages.filter(page=>!process.env.DESIGN_FIDELITY_PAGES||process.env.DESIGN_FIDELITY_PAGES.split(",").includes(page.id))).map(omission=>({matrix:item.id,...omission})));
        await page.screenshot({path:join(output,`${item.id}-editor-gui.png`)});
        // Reserve a bounded surface for a common crop. This adjusts only editor
        // chrome, never document nodes or renderer output.
        report.chromeExclusion="Comparison crops reserve a 1600x1000 stage, hide #stage interaction/labels with opacity:0, and use canvas.background behind the transparent GPU surface. Only while capturing comparison PNGs, direct-child canvas-meta, infinite-canvas-hint, renderer-message, selection-size and inline-text-editor have visibility:hidden. Actual GUI screenshots and renderer controls restore all editor chrome. No design content is hidden.";
        const chromeSelectors=[".canvas-meta","#infinite-canvas-hint","#renderer-message","#selection-size","#inline-text-editor"];
        const captureSelectors=chromeSelectors.map(selector=>`#stage-wrap[data-fidelity-capture="true"] > ${selector}`).join(",");
        const stageStyle=`#stage-wrap{position:fixed!important;inset:0!important;width:1600px!important;height:1000px!important;z-index:10000!important;border:0!important;border-radius:0!important;background:${data.design.canvas.background}!important}#stage{opacity:0!important}${captureSelectors}{visibility:hidden!important}`;
        let chromeStyle=await page.addStyleTag({content:stageStyle});await frames(page);
        for(const pageInfo of data.design.pages){
          if(process.env.DESIGN_FIDELITY_PAGES&&!process.env.DESIGN_FIDELITY_PAGES.split(",").includes(pageInfo.id))continue;
          await page.locator("#active-page").selectOption(pageInfo.id);
          await page.waitForFunction(async id=>(await tools.get_design_metadata({})).activePageId===id,pageInfo.id);
          const design=normalizeDesignDocument(JSON.parse(serializeDesignDocument(data.design)));design.activePageId=pageInfo.id;design.nodes=design.pages.find(p=>p.id===pageInfo.id).nodes;
          // Real portable input remains exactly as saved. Do not compensate
          // authoring geometry by reflowing only one export route.
          const bounds=designPageBounds(design), captureBounds={x:Math.floor(bounds.x)-12,y:Math.floor(bounds.y)-12,width:Math.ceil(bounds.x+bounds.width)-Math.floor(bounds.x)+24,height:Math.ceil(bounds.y+bounds.height)-Math.floor(bounds.y)+24}, pageTiles=tiles(captureBounds,item.zoom), seen=new Set(),completeSeen=new Set();
          const css=designFrontendCss(design,{resourceDataUrls:data.dataUrls,preserveWorldOrigin:true}),html=renderDesignFrontendPage(design,{resourceDataUrls:data.dataUrls,preserveWorldOrigin:true});
          let svg;const svgSource=await f.context.newPage();
          try{
            // SVG export runs in Chromium after the identical font bytes are
            // ready. This exercises browser metric adapters, not Node fallback.
            const fontCss=designFontFaceCss(design.resources,data.dataUrls);
            f.routes.set("/fidelity-export-source.html",`<!doctype html><meta charset="utf-8"><style>${fontCss}</style>`);
            await svgSource.goto(origin+"/fidelity-export-source.html");
            svg=await svgSource.evaluate(async({design,dataUrls})=>{
              for(const node of design.nodes.filter(node=>node.type==="text"))await document.fonts.load(`${node.fontWeight} ${node.fontSize}px ${node.fontFamily}`,node.text);
              await document.fonts.ready;const {exportDesignSvg}=await import("/document.mjs");
              return exportDesignSvg(design,{resourceDataUrls:new Map(dataUrls),maxBytes:4*1024*1024});
            },{design,dataUrls:[...data.dataUrls]});
          }catch(error){report.failures.push({matrix:item.id,page:pageInfo.id,route:"svg",error:String(error)});}finally{await svgSource.close();}
          if(svg)for(const node of design.nodes.filter(n=>Number.isFinite(n.layoutBaselineOffset))){
            const parsed=await page.evaluate(({svg,id})=>{const doc=new DOMParser().parseFromString(svg,"image/svg+xml");return doc.querySelector(`[data-node-id="${CSS.escape(id)}"]`)?.outerHTML??null;},{svg,id:node.id});
            report.finiteCompatibility.push({matrix:item.id,page:pageInfo.id,id:node.id,svg:parsed,svgSha256:hash(parsed??"")});
          }
          for(const [tileIndex,tile]of pageTiles.entries()){
            const key=`${item.id}-${pageInfo.id}-${tileIndex}`,folder=join(output,key);await mkdir(folder,{recursive:true});
            const record={matrix:item.id,page:pageInfo.id,tileIndex,tile,scale:item.dpr*item.zoom,paths:{},routeErrors:[],calibration:{}};report.records.push(record);
            const images={},clip={x:32,y:32,width:Math.round(tile.width*item.zoom),height:Math.round(tile.height*item.zoom)};
            for(const mode of ["gpu","browser"]){
              try{
                await page.locator("#renderer-mode").selectOption(mode);await rendererReady(page,mode);
                if(tileIndex===0){await chromeStyle.evaluate(element=>element.remove());await frames(page);await page.screenshot({path:join(folder,`${mode}-editor-gui.png`)});chromeStyle=await page.addStyleTag({content:stageStyle});await frames(page);}
                record.view=await align(page,tile,item.zoom);await rendererReady(page,mode);
                await page.locator("#stage-wrap").evaluate(element=>{element.dataset.fidelityCapture="true";});await frames(page);
                try{
                  const chromeProof=await page.evaluate(({selectors,mode})=>({controls:selectors.map(selector=>({selector,visibility:getComputedStyle(document.querySelector(`#stage-wrap > ${selector}`)).visibility})),contentVisible:getComputedStyle(document.querySelector(mode==="gpu"?"#gpu-canvas":"#browser-surface")).visibility==="visible",interactionOverlayOpacity:getComputedStyle(document.querySelector("#stage")).opacity}),{selectors:chromeSelectors,mode});
                  assert(chromeProof.contentVisible&&chromeProof.controls.every(control=>control.visibility==="hidden")&&chromeProof.interactionOverlayOpacity==="0","only editor chrome is excluded from comparison capture");
                  (record.chromeProof??={})[mode]=chromeProof;
                  const bytes=await page.screenshot({clip,path:join(folder,`${mode}.png`)});images[mode]=PNG.sync.read(bytes);record.paths[mode]=join(folder,`${mode}.png`);
                  if(mode==="gpu"){
                    record.gpu=await page.evaluate(()=>window.__fidelityGpuStats());assert.equal(record.gpu.backend,"WebGL2");
                    const repeat=PNG.sync.read(await page.screenshot({clip,path:join(folder,"gpu-repeat.png")}));record.calibration.gpu=symmetricPixelDifference(images.gpu,repeat);
                    assert.equal(record.calibration.gpu.mismatchPixels,0,"GPU/GPU calibration must be zero");
                  }
                }finally{await page.locator("#stage-wrap").evaluate(element=>{delete element.dataset.fidelityCapture;});await frames(page);}
              }catch(error){record.routeErrors.push({route:mode,error:String(error)});report.failures.push({matrix:item.id,page:pageInfo.id,tileIndex,route:mode,error:String(error)});}
            }
            for(const route of ["html","svg"]){
              if(route==="svg"&&!svg)continue;
              const ref=await f.context.newPage();
              try{
                const content=route==="html"?html:svg.replace("<svg ",`<svg style="position:absolute;left:${bounds.x}px;top:${bounds.y}px" `);
                const styles=route==="html"?css:designFontFaceCss(design.resources,data.dataUrls);
                const url=`/fidelity-${route}.html`;
                f.routes.set(url,`<!doctype html><meta charset="utf-8"><style>${styles}\nhtml,body{margin:0;background:${design.canvas.background};overflow:hidden}#export-world{position:absolute;left:32px;top:32px;width:${Math.max(design.canvas.width,bounds.width)}px;transform-origin:0 0;transform:scale(${item.zoom}) translate(${-tile.x}px,${-tile.y}px)}.cs-page{margin:0!important;overflow:visible!important}</style><div id="export-world">${content}</div>`);
                await ref.goto(origin+url);await ref.evaluate(()=>document.fonts.ready);await frames(ref);
                const bytes=await ref.screenshot({clip,path:join(folder,`${route}.png`)});images[route]=PNG.sync.read(bytes);record.paths[route]=join(folder,`${route}.png`);
                if(route==="html"){
                  const repeat=PNG.sync.read(await ref.screenshot({clip,path:join(folder,"html-repeat.png")}));record.calibration.html=symmetricPixelDifference(images.html,repeat);assert.equal(record.calibration.html.mismatchPixels,0,"HTML/HTML calibration must be zero");
                  record.dom=await ref.locator("[data-codeshell-id]").evaluateAll(elements=>elements.map(element=>{const box=element.getBoundingClientRect();return{id:element.dataset.codeshellId,x:box.x,y:box.y,width:box.width,height:box.height,font:getComputedStyle(element).font};}));
                }
              }catch(error){record.routeErrors.push({route,error:String(error)});report.failures.push({matrix:item.id,page:pageInfo.id,tileIndex,route,error:String(error)});}finally{await ref.close();}
            }
            if(images.html){
              record.nodes=compareNodes(images,design.nodes,tile,item,design.canvas,data.real);
              for(const node of record.nodes){seen.add(node.id);if(node.complete)completeSeen.add(node.id);for(const [route,value]of Object.entries(node.measurements))if(value.gateFailures.length)report.failures.push({matrix:item.id,page:pageInfo.id,tileIndex,id:node.id,route,failures:value.gateFailures});}
              const sheetLeft=Math.max(bounds.x,tile.x),sheetTop=Math.max(bounds.y,tile.y),sheetRight=Math.min(bounds.x+bounds.width,tile.x+tile.width),sheetBottom=Math.min(bounds.y+bounds.height,tile.y+tile.height),scale=item.dpr*item.zoom;
              record.wholeImageRoi={x:(sheetLeft-tile.x)*scale,y:(sheetTop-tile.y)*scale,width:(sheetRight-sheetLeft)*scale,height:(sheetBottom-sheetTop)*scale};
              record.wholeImage=Object.fromEntries(Object.entries(images).map(([route,image])=>[route,symmetricPixelDifference(images.html,image,{roi:record.wholeImageRoi})]));
            }
            await writeFile(join(folder,"metrics.json"),JSON.stringify(record,null,2)+"\n");
            t.diagnostic(`${key}: ${Object.keys(images).join("/")} raster=${record.gpu?.rasterTextNodes??"unavailable"} native=${record.gpu?.nativeTextNodes??"unavailable"} failures=${report.failures.length}`);
          }
          for(const node of design.nodes.filter(n=>n.visible!==false&&(n.type==="text"||n.strokeWidth>0||n.strokeSides)))if(!seen.has(node.id))report.unmeasured.push({matrix:item.id,page:pageInfo.id,id:node.id,reason:"No complete uncontaminated ROI in captured tiles; oversized/edge probe requires separate isolation"});
          for(const id of seen)if(!completeSeen.has(id))report.partialNodes.push({matrix:item.id,page:pageInfo.id,id,reason:"All visible segments measured; no one tile contains full node bounds"});
        }
        assert.deepEqual(f.errors,[],"no uncaught editor exceptions");assert.deepEqual(f.blocked,[],"offline fixture must not contact external origins");
        assert.equal(f.calls.filter(call=>call.method==="workspace.writeText").length,0,"read-only document never saved or recovered");
      }finally{await f.context.close();}
    }
  }finally{
    await browser.close();
    if(data.real)assert.equal(hash(await readFile(process.env.DESIGN_FIDELITY_REAL_FIXTURE)),data.inputHash,"private source bytes unchanged");
    const comparisons=report.records.flatMap(record=>(record.nodes??[]).flatMap(node=>Object.values(node.measurements)));
    const diagnosticFailures=comparisons.filter(value=>value.gating==="diagnostic"&&value.failures.length).length;
    const diagnosticComparisons=comparisons.filter(value=>value.gating==="diagnostic").length;
    const unavailablePrimary=comparisons.filter(value=>!value.primaryAvailable).length;
    report.summary={comparisons:report.records.length,failingChecks:report.failures.length,diagnosticFailures,diagnosticComparisons,unavailablePrimary,unmeasured:report.unmeasured.length,partialNodes:report.partialNodes.length,fontOmissions:report.fontOmissions.length,allMeasuredThresholdsPassed:report.failures.length===0&&diagnosticComparisons===0&&unavailablePrimary===0&&report.unmeasured.length===0&&report.partialNodes.length===0&&report.fontOmissions.length===0,diagnosticModeDoesNotMeanPass:diagnostic};
    await writeFile(join(output,"report.json"),JSON.stringify(report,null,2)+"\n");
    t.diagnostic(`EVIDENCE ${join(output,"report.json")} ${JSON.stringify(report.summary)}`);
  }
  if(!diagnostic){assert.equal(report.failures.length,0,`Fidelity candidate has ${report.failures.length} threshold/route failures; see ${join(output,"report.json")}`);assert.equal(report.unmeasured.length,0,"all requested text/stroke nodes require measurements");assert.equal(report.partialNodes.length,0,"partial tile geometry cannot establish complete-node parity");assert.equal(report.summary.unavailablePrimary,0,"unavailable primary metrics cannot establish parity");assert.equal(report.summary.diagnosticComparisons,0,"unresolved diagnostic comparisons cannot establish full parity");assert.equal(report.fontOmissions.length,0,"fallback diagnostics cannot certify an unavailable requested font");}
});
