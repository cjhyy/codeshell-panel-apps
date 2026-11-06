import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { fidelityFontOmissions, renderFidelityFixture } from "./render-fidelity.fixture.mjs";
import { FIDELITY_THRESHOLDS, geometryDifference, inkGeometry, parseRgb, strokeEdgeScans, symmetricPixelDifference, textGeometryFailures } from "./render-fidelity.metrics.mjs";
import { compareGeometryProbe } from "./render-fidelity-geometry.mjs";
import { isolateFidelityDesign, selectUniqueMeasurements, classifyHtmlPixelSnap, fidelityCounts, stitchFidelityTiles, fidelityIsolationPlan } from "./render-fidelity-attribution.mjs";

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
const output = resolve(process.env.DESIGN_FIDELITY_EVIDENCE ?? ".tmp/render-fidelity-r002/current");
const diagnostic = process.env.DESIGN_FIDELITY_MODE === "diagnostic";
const isolateAllText = process.env.DESIGN_FIDELITY_ISOLATE_TEXT === "1";
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
        // Hooks exist only in these intercepted test bytes, never production
        // files. Isolation passes the same cloned scene into both real editors.
        const marker="return { setScene, resize, render, dispose, stats };";
        const entry="async function setScene(design, { resources = new Map() } = {}) {";
        assert(body.toString().includes(marker)&&body.toString().includes(entry),"GPU test hooks remain anchored");
        body=Buffer.from(body.toString().replace(entry,`let fidelityResources; ${entry} fidelityResources = resources;`).replace(marker,`globalThis.__fidelityGpuStats = stats; globalThis.__fidelityGpuScene = async design => setScene(design,{resources:fidelityResources}); globalThis.__fidelityGpuRender = render; ${marker}`));
      }
      if(url.pathname==="/canvas/browser-renderer.mjs") {
        const marker="return {setScene,resize,render,hitTest,cancelPreparation,stats:";
        const entry="async function setScene(input, {resources = new Map(), viewOptions = {}} = {}) {";
        assert(body.toString().includes(marker)&&body.toString().includes(entry),"browser test hooks remain anchored");
        body=Buffer.from(body.toString().replace(entry,`let fidelityResources, fidelityOptions; ${entry} fidelityResources = resources; fidelityOptions = viewOptions;`).replace(marker,`globalThis.__fidelityBrowserScene = async design => setScene(design,{resources:fidelityResources,viewOptions:fidelityOptions}); globalThis.__fidelityBrowserRender = render; ${marker}`));
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
function compareNodes(images,nodes,tile,item,canvas,real,{targetId}={}) {
  const scale=item.dpr*item.zoom,rows=[];
  for(const node of nodes){
    if(targetId&&node.id!==targetId)continue;
    if(node.visible===false||!(node.type==="text"||node.strokeWidth>0||node.strokeSides||["radius","rotation","shadow","shadow-stack","opacity","button-edge","selector-edge","clipped-child"].includes(node.id)))continue;
    const inset=8,clearance=Math.min(node.x-inset-tile.x,node.y-inset-tile.y,tile.x+tile.width-node.x-node.width-inset,tile.y+tile.height-node.y-node.height-inset),complete=clearance>=-1e-6;
    if(node.x+node.width<=tile.x||node.x>=tile.x+tile.width||node.y+node.height<=tile.y||node.y>=tile.y+tile.height)continue;
    const left=Math.max(node.x-inset,tile.x),top=Math.max(node.y-inset,tile.y),right=Math.min(node.x+node.width+inset,tile.x+tile.width),bottom=Math.min(node.y+node.height+inset,tile.y+tile.height);
    const roi={x:(left-tile.x)*scale,y:(top-tile.y)*scale,width:(right-left)*scale,height:(bottom-top)*scale},background=backgroundFor(node,nodes,canvas);
    let foreground=parseRgb(node.type==="text"||!(node.strokeWidth>0)?node.fill:node.stroke);
    if(node.type==="text"&&node.strokeWidth>0&&foreground&&background&&foreground.every((v,i)=>v===background[i]))foreground=parseRgb(node.stroke);
    const diagnosticReasons=[];
    if(Number.isFinite(node.layoutBaselineOffset))diagnosticReasons.push("FINITE_OFFSET_COMPATIBILITY_ONLY");
    if(node.rotation)diagnosticReasons.push("ROTATED_AXIS_ALIGNED_INK_ROI");
    const measurements={};
    for(const route of ["gpu","browser","svg","html"]){
      const image=images[route];
      if(!image||!images.html){measurements[route]={ink:null,primaryAvailable:false,unavailableReasonCodes:[!image?"ROUTE_CAPTURE_FAILED":"HTML_REFERENCE_MISSING"],failures:[],gateFailures:[],gating:"unavailable"};continue;}
      const pixel=symmetricPixelDifference(images.html,image,{roi}),foregrounds=[foreground,...(node.textRanges?.ranges??[]).map(range=>parseRgb(range.fill))].filter(Boolean);
      const ink=foreground&&background?inkGeometry(image,{roi,foreground,foregrounds,background}):null;
      const value=measurements[route]={ink,pixel,cropSha256:hash(crop(image,roi)),unavailableReasonCodes:[]};
      value.geometryProbe=compareGeometryProbe(images.html,image,{node,tile,scale});
      if(node.strokeWidth>0&&node.type!=="text"&&!node.rotation){
        value.strokeEdges=strokeEdgeScans(image,{bounds:{x:(node.x-tile.x)*scale,y:(node.y-tile.y)*scale,width:node.width*scale,height:node.height*scale},strokeWidth:node.strokeWidth*scale,strokeAlign:node.strokeAlign,cornerRadius:(node.cornerRadius??0)*scale,
          foreground:parseRgb(node.stroke)??[0,0,0],background:parseRgb(node.fill)??background??[255,255,255],outsideBackground:background??[255,255,255]});
      }
    }
    const strokeClassification=classifyHtmlPixelSnap({node,scale,measurements});
    for(const [route,value]of Object.entries(measurements)){
      if(!value.pixel)continue;
      value.delta=geometryDifference(measurements.html.ink,value.ink);value.failures=[];value.diagnosticFailures=[];
      if(value.geometryProbe)value.failures.push(...value.geometryProbe.failures);
      value.primaryAvailable=value.geometryProbe?value.geometryProbe.measurable:node.type==="text"?value.delta.measurable:node.strokeWidth>0?Boolean(value.strokeEdges?.measurable&&measurements.html.strokeEdges?.measurable):Boolean(value.ink);
      if(!value.primaryAvailable){
        if(!complete)value.unavailableReasonCodes.push("TILE_TRUNCATED");
        if(!foreground||!background)value.unavailableReasonCodes.push("UNSUPPORTED_PAINT_PROJECTION");
        else if(foreground.every((v,i)=>v===background[i]))value.unavailableReasonCodes.push("NO_FOREGROUND_CONTRAST");
        if(value.strokeEdges){value.unavailableReasonCodes.push(...value.strokeEdges.unavailable.map(entry=>entry.reasonCode));if(!measurements.html.strokeEdges?.measurable)value.unavailableReasonCodes.push("HTML_REFERENCE_STROKE_UNAVAILABLE");}
        if(node.type==="text"&&!measurements.html.ink)value.unavailableReasonCodes.push("HTML_REFERENCE_INK_NOT_FOUND");
        if(value.geometryProbe&&!value.geometryProbe.measurable)value.unavailableReasonCodes.push("GEOMETRY_PROBE_UNAVAILABLE");
        if(!value.unavailableReasonCodes.length)value.unavailableReasonCodes.push("INK_NOT_FOUND");
        value.unavailableReasonCodes=[...new Set(value.unavailableReasonCodes)];
      }
      if(node.type==="text"&&!diagnosticReasons.length)value.failures.push(...textGeometryFailures(value.delta,{scale,align:node.textAlign}));
      if(value.strokeEdges&&measurements.html.strokeEdges){
        value.strokeDeltas=value.strokeEdges.probes.flatMap(probe=>{const reference=measurements.html.strokeEdges.probes.find(other=>other.edge===probe.edge&&other.fraction===probe.fraction);return reference?[{edge:probe.edge,fraction:probe.fraction,centroid:probe.centroid-reference.centroid,width:probe.width-reference.width}]:[];});
        for(const delta of value.strokeDeltas){
          if(Math.abs(delta.centroid)>.35)value.failures.push(`stroke ${delta.edge}@${delta.fraction} centroid ${delta.centroid} > .35`);
          if(Math.abs(delta.width)>.35)value.failures.push(`stroke ${delta.edge}@${delta.fraction} width ${delta.width} > .35`);
        }
        if(strokeClassification&&["gpu","svg"].includes(route))value.strokeClassification=strokeClassification;
      }
      const maximum=node.type==="text"?.005:.001,pixelFailures=[];
      if(value.pixel.mismatchRatio>maximum)pixelFailures.push(`pixel mismatch ${value.pixel.mismatchRatio} > ${maximum}`);
      if(value.pixel.largestCluster>6)pixelFailures.push(`pixel cluster ${value.pixel.largestCluster} > 6`);
      value.failures.push(...pixelFailures);
      // CC permits SVG text pixels and every half-zoom metric as diagnostics;
      // SVG text geometry at the three primary matrices remains strict.
      value.gating=item.zoom===.5||diagnosticReasons.length&&!value.geometryProbe?.measurable?"diagnostic":"primary-and-secondary";
      value.gateFailures=value.gating==="diagnostic"?[]:route==="svg"&&node.type==="text"?value.failures.filter(reason=>!reason.startsWith("pixel")):value.failures;
      if(value.gating==="diagnostic")value.diagnosticFailures=[...value.failures];
      else if(route==="svg"&&node.type==="text")value.diagnosticFailures=pixelFailures;
    }
    rows.push({id:node.id,type:node.type,complete,clearance,partialReasonCode:complete?null:"TILE_TRUNCATED",geometry:{x:node.x,y:node.y,width:node.width,height:node.height},diagnosticReasons,measurements});
  }
  return rows;
}

async function measuredSvg(f,design,data) {
  const page=await f.context.newPage();
  try{
    f.routes.set("/fidelity-export-source.html",`<!doctype html><meta charset="utf-8"><style>${designFontFaceCss(design.resources,data.dataUrls)}</style>`);
    await page.goto(origin+"/fidelity-export-source.html");
    return await page.evaluate(async({design,dataUrls})=>{
      for(const node of design.nodes.filter(node=>node.type==="text"&&node.opacity!==0))await document.fonts.load(`${node.fontWeight} ${node.fontSize}px ${node.fontFamily}`,node.text);
      await document.fonts.ready;const {exportDesignSvg}=await import("/document.mjs");
      return exportDesignSvg(design,{resourceDataUrls:new Map(dataUrls),maxBytes:4*1024*1024});
    },{design,dataUrls:[...data.dataUrls]});
  }finally{await page.close();}
}
const chromeSelectors=[".canvas-meta","#infinite-canvas-hint","#renderer-message","#selection-size","#inline-text-editor"];
async function captureRecord({f,design,data,item,tile,tileIndex,folder,svg,stageStyle,bounds,isolation=null,gui=false}) {
  await mkdir(folder,{recursive:true});
  const record={matrix:item.id,page:design.activePageId,tileIndex,tile,scale:item.dpr*item.zoom,paths:{},routeErrors:[],calibration:{},isolation};
  const images={},clip={x:32,y:32,width:Math.round(tile.width*item.zoom),height:Math.round(tile.height*item.zoom)},page=f.page;
  for(const mode of ["gpu","browser"]){
    try{
      await page.locator("#renderer-mode").selectOption(mode);await rendererReady(page,mode);
      if(gui){await f.chromeStyle.evaluate(element=>element.remove());await frames(page);await page.screenshot({path:join(folder,`${mode}-editor-gui.png`)});f.chromeStyle=await page.addStyleTag({content:stageStyle});await frames(page);}
      record.view=await align(page,tile,item.zoom);
      // The actual mounted editor renderer receives the exact same transformed
      // document as the exports. Resource bytes are its existing owned resources.
      await page.evaluate(async({mode,design,view})=>{
        await window[mode==="gpu"?"__fidelityGpuScene":"__fidelityBrowserScene"](design);
        window[mode==="gpu"?"__fidelityGpuRender":"__fidelityBrowserRender"]({pan:{x:view.panX,y:view.panY},zoom:view.zoom});
        await document.fonts.ready;
      },{mode,design,view:record.view});await frames(page);
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
    }catch(error){record.routeErrors.push({route:mode,reasonCode:"ROUTE_CAPTURE_FAILED",error:String(error)});}
  }
  const css=designFrontendCss(design,{resourceDataUrls:data.dataUrls,preserveWorldOrigin:true}),html=renderDesignFrontendPage(design,{resourceDataUrls:data.dataUrls,preserveWorldOrigin:true});
  for(const route of ["html","svg"]){
    if(route==="svg"&&!svg){record.routeErrors.push({route,reasonCode:"SVG_EXPORT_FAILED"});continue;}
    const ref=await f.context.newPage();
    try{
      const content=route==="html"?html:svg.replace("<svg ",`<svg style="position:absolute;left:${bounds.x}px;top:${bounds.y}px" `),styles=route==="html"?css:designFontFaceCss(design.resources,data.dataUrls),url=`/fidelity-${route}.html`;
      f.routes.set(url,`<!doctype html><meta charset="utf-8"><style>${styles}\nhtml,body{margin:0;background:${design.canvas.background};overflow:hidden}#export-world{position:absolute;left:32px;top:32px;width:${Math.max(design.canvas.width,bounds.width)}px;transform-origin:0 0;transform:scale(${item.zoom}) translate(${-tile.x}px,${-tile.y}px)}.cs-page{margin:0!important;overflow:visible!important}</style><div id="export-world">${content}</div>`);
      await ref.goto(origin+url);await ref.evaluate(()=>document.fonts.ready);await frames(ref);
      const bytes=await ref.screenshot({clip,path:join(folder,`${route}.png`)});images[route]=PNG.sync.read(bytes);record.paths[route]=join(folder,`${route}.png`);
      if(route==="html"){
        const repeat=PNG.sync.read(await ref.screenshot({clip,path:join(folder,"html-repeat.png")}));record.calibration.html=symmetricPixelDifference(images.html,repeat);assert.equal(record.calibration.html.mismatchPixels,0,"HTML/HTML calibration must be zero");
        record.dom=await ref.locator("[data-codeshell-id]").evaluateAll(elements=>elements.map(element=>{const box=element.getBoundingClientRect();return{id:element.dataset.codeshellId,x:box.x,y:box.y,width:box.width,height:box.height,font:getComputedStyle(element).font};}));
      }
    }catch(error){record.routeErrors.push({route,reasonCode:"ROUTE_CAPTURE_FAILED",error:String(error)});}finally{await ref.close();}
  }
  record.nodes=compareNodes(images,design.nodes,tile,item,design.canvas,data.real,{targetId:isolation?.targetId});
  if(images.html){
    const sheetLeft=Math.max(bounds.x,tile.x),sheetTop=Math.max(bounds.y,tile.y),sheetRight=Math.min(bounds.x+bounds.width,tile.x+tile.width),sheetBottom=Math.min(bounds.y+bounds.height,tile.y+tile.height),scale=item.dpr*item.zoom;
    record.wholeImageRoi={x:(sheetLeft-tile.x)*scale,y:(sheetTop-tile.y)*scale,width:(sheetRight-sheetLeft)*scale,height:(sheetBottom-sheetTop)*scale};
    if(!isolation)record.wholeImage=Object.fromEntries(Object.entries(images).map(([route,image])=>[route,symmetricPixelDifference(images.html,image,{roi:record.wholeImageRoi})]));
  }
  await writeFile(join(folder,"metrics.json"),JSON.stringify(record,null,2)+"\n");return record;
}
function isolationBounds(node,zoom) {
  const shadowReach=shadow=>(shadow?.blur??0)*3+Math.max(Math.abs(shadow?.x??0),Math.abs(shadow?.y??0))+Math.max(0,shadow?.spread??0);
  const strokeOutset=(node.strokeWidth??0)*(node.strokeAlign==="inside"?0:node.strokeAlign==="outside"?1:.5);
  const angle=(node.rotation??0)*Math.PI/180,rotatedWidth=Math.abs(node.width*Math.cos(angle))+Math.abs(node.height*Math.sin(angle)),rotatedHeight=Math.abs(node.width*Math.sin(angle))+Math.abs(node.height*Math.cos(angle));
  const padding=Math.max(12,strokeOutset+8,shadowReach(node.shadow)+8,...(node.shadowStack?.layers??[]).filter(layer=>layer.kind==="outer"&&layer.visible!==false).map(layer=>shadowReach(layer)+strokeOutset+8),(rotatedWidth-node.width)/2+8,(rotatedHeight-node.height)/2+8);
  const x=Math.floor(node.x-padding),y=Math.floor(node.y-padding);
  return {x,y,width:Math.ceil((node.x+node.width+padding-x)*zoom)/zoom,height:Math.ceil((node.y+node.height+padding-y)*zoom)/zoom};
}
async function captureIsolation(options) {
  const {design,item,tile:full,folder,isolation}=options,segments=tiles(full,item.zoom);
  if(segments.length===1)return {record:await captureRecord(options),tileRecords:[]};
  const tileRecords=[];
  for(const [index,tile]of segments.entries())tileRecords.push(await captureRecord({...options,tile,tileIndex:`${options.tileIndex}-tile-${index}`,folder:join(folder,`tile-${index}`)}));
  const first=tileRecords[0],scale=item.dpr*item.zoom,record={matrix:item.id,page:design.activePageId,tileIndex:options.tileIndex,tile:full,scale,
    isolation,paths:{},view:first.view,dom:first.dom,gpu:first.gpu,chromeProof:first.chromeProof,
    routeErrors:tileRecords.flatMap((entry,tileIndex)=>entry.routeErrors.map(error=>({...error,tileIndex}))),
    calibration:{rawTiles:tileRecords.map(entry=>({tileIndex:entry.tileIndex,...entry.calibration}))},
    composite:{kind:"derived-same-coordinate-pixel-stitch",singleScreenshot:false,sourceMetrics:segments.map((_,index)=>join(folder,`tile-${index}`,"metrics.json")),routes:{}}};
  const images={};
  for(const route of ["gpu","browser","svg","html"]){
    try{
      const sources=[];
      for(const entry of tileRecords){
        if(!entry.paths[route])throw Object.assign(Error(`Missing ${route} raw isolation tile`),{code:"COMPOSITE_ROUTE_TILE_MISSING"});
        const bytes=await readFile(entry.paths[route]);sources.push({image:PNG.sync.read(bytes),tile:entry.tile,source:entry.paths[route],sourceSha256:hash(bytes)});
      }
      const stitched=stitchFidelityTiles(sources,{bounds:full,scale}),png=new PNG({width:stitched.image.width,height:stitched.image.height});png.data=Buffer.from(stitched.image.data);
      const bytes=PNG.sync.write(png),path=join(folder,`derived-composite-${route}.png`);await writeFile(path,bytes);
      record.paths[route]=path;record.composite.routes[route]={...stitched.provenance,outputSha256:hash(bytes),outputPath:path};images[route]=png;
    }catch(error){record.routeErrors.push({route,reasonCode:error.code??"COMPOSITE_BUILD_FAILED",error:String(error)});}
  }
  record.nodes=compareNodes(images,design.nodes,full,item,design.canvas,options.data.real,{targetId:isolation.targetId});
  await writeFile(join(folder,"metrics.json"),JSON.stringify(record,null,2)+"\n");return {record,tileRecords};
}

test("B0 four-route actual-editor fidelity matrix (strict by default)",{timeout:3600000},async t=>{
  await mkdir(output,{recursive:true});const data=await dataset(),report={schema:2,mode:diagnostic?"diagnostic":"strict",capturePolicy:{isolateAllText},sourceApp:app,real:data.real,inputSha256:data.inputHash,serializedSha256:data.serializedHash,thresholds:FIDELITY_THRESHOLDS,matrix,viewport:{width:1600,height:1000},launchArgs:["--enable-webgl","--enable-unsafe-swiftshader","--use-angle=swiftshader"],records:[],isolationRecords:[],isolationTileRecords:[],uniqueRecords:[],failures:[],unmeasured:[],partialNodes:[],finiteCompatibility:[],fontAvailability:[],fontOmissions:[],environment:{platform:process.platform,arch:process.arch,node:process.version}};
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
        report.chromeExclusion="Comparison crops reserve a 1600x1000 stage, hide #stage interaction/labels with opacity:0, and use canvas.background behind the transparent GPU surface. Only while capturing comparison PNGs, direct-child canvas-meta, infinite-canvas-hint, renderer-message, selection-size and inline-text-editor have visibility:hidden. Actual GUI screenshots and renderer controls restore all editor chrome. No design content is hidden.";
        report.isolationContract="Only isolationRecords apply the same immutable scene transform through actual GPU and browser setScene and both exports. Non-target paint is hidden via opacity-zero layout placeholders, with ancestor fills, original opacity, clip, transforms and layout retained. Raw full-scene PNGs and records are preserved.";
        const captureSelectors=chromeSelectors.map(selector=>`#stage-wrap[data-fidelity-capture="true"] > ${selector}`).join(","),stageStyle=`#stage-wrap{position:fixed!important;inset:0!important;width:1600px!important;height:1000px!important;z-index:10000!important;border:0!important;border-radius:0!important;background:${data.design.canvas.background}!important}#stage{opacity:0!important}${captureSelectors}{visibility:hidden!important}`;
        f.chromeStyle=await page.addStyleTag({content:stageStyle});await frames(page);
        for(const pageInfo of data.design.pages){
          if(process.env.DESIGN_FIDELITY_PAGES&&!process.env.DESIGN_FIDELITY_PAGES.split(",").includes(pageInfo.id))continue;
          await page.locator("#active-page").selectOption(pageInfo.id);await page.waitForFunction(async id=>(await tools.get_design_metadata({})).activePageId===id,pageInfo.id);
          const design=normalizeDesignDocument(JSON.parse(serializeDesignDocument(data.design)));design.activePageId=pageInfo.id;design.nodes=design.pages.find(p=>p.id===pageInfo.id).nodes;
          const bounds=designPageBounds(design),captureBounds={x:Math.floor(bounds.x)-12,y:Math.floor(bounds.y)-12,width:Math.ceil(bounds.x+bounds.width)-Math.floor(bounds.x)+24,height:Math.ceil(bounds.y+bounds.height)-Math.floor(bounds.y)+24},pageTiles=tiles(captureBounds,item.zoom);
          let svg;try{svg=await measuredSvg(f,design,data);}catch(error){report.failures.push({matrix:item.id,page:pageInfo.id,route:"svg",reasonCode:"SVG_EXPORT_FAILED",error:String(error)});}
          if(svg)for(const node of design.nodes.filter(n=>Number.isFinite(n.layoutBaselineOffset))){
            const parsed=await page.evaluate(({svg,id})=>{const doc=new DOMParser().parseFromString(svg,"image/svg+xml");return doc.querySelector(`[data-node-id="${CSS.escape(id)}"]`)?.outerHTML??null;},{svg,id:node.id});
            report.finiteCompatibility.push({matrix:item.id,page:pageInfo.id,id:node.id,svg:parsed,svgSha256:hash(parsed??"")});
          }
          const raw=[];
          for(const [tileIndex,tile]of pageTiles.entries()){
            const key=`${item.id}-${pageInfo.id}-${tileIndex}`,record=await captureRecord({f,design,data,item,tile,tileIndex,folder:join(output,key),svg,stageStyle,bounds,gui:tileIndex===0});
            raw.push(record);report.records.push(record);t.diagnostic(`${key}: raw ${record.nodes.length} nodes, ${record.routeErrors.length} route errors`);
          }
          const unique=selectUniqueMeasurements(raw),requested=design.nodes.filter(node=>node.visible!==false&&(node.type==="text"||node.strokeWidth>0||node.strokeSides)),isolationPlan=fidelityIsolationPlan(unique,requested,{isolateAllText}),targets=new Set(isolationPlan.map(entry=>entry.id));
          // Isolate every failed/unavailable raw target using a shared scene;
          // this is mandatory, not a switch which can silently certify raw ROIs.
          for(const [index,id]of [...targets].entries()){
            const isolated=isolateFidelityDesign(design,id),node=isolated.design.nodes.find(node=>node.id===id),tile=isolationBounds(node,item.zoom),isolatedBounds=designPageBounds(isolated.design);
            let isolatedSvg;try{isolatedSvg=await measuredSvg(f,isolated.design,data);}catch(error){isolated.metadata.svgError=String(error);}
            const {record,tileRecords}=await captureIsolation({f,design:isolated.design,data,item,tile,tileIndex:`isolation-${index}`,folder:join(output,`${item.id}-${pageInfo.id}-isolation-${encodeURIComponent(id)}`),svg:isolatedSvg,stageStyle,bounds:isolatedBounds,isolation:{...isolated.metadata,triggerReasons:isolationPlan.find(entry=>entry.id===id).reasonCodes}});
            report.isolationTileRecords.push(...tileRecords);
            const rawDom=raw.find(entry=>entry.dom?.some(node=>node.id===id));
            const worldBox=(entry,dom)=>({x:(dom.x-32)/item.zoom+entry.tile.x,y:(dom.y-32)/item.zoom+entry.tile.y,width:dom.width/item.zoom,height:dom.height/item.zoom});
            record.isolationDomProof=[id,...isolated.metadata.ancestorIds].map(nodeId=>{
              const before=rawDom?.dom.find(node=>node.id===nodeId),after=record.dom?.find(node=>node.id===nodeId);
              if(!before||!after)return{id:nodeId,preserved:false,reasonCode:"DOM_GEOMETRY_UNAVAILABLE"};
              const reference=worldBox(rawDom,before),actual=worldBox(record,after),maximumDelta=Math.max(...Object.keys(reference).map(field=>Math.abs(reference[field]-actual[field])));
              return{id:nodeId,reference,actual,maximumDelta,preserved:maximumDelta<=1/64};
            });
            if(record.isolationDomProof.some(proof=>!proof.preserved))record.routeErrors.push({route:"isolation",reasonCode:"ISOLATION_LAYOUT_CHANGED_OR_UNAVAILABLE",error:"Target/ancestor DOM bounds must be unchanged by the paint-only isolation transform"});
            await writeFile(join(output,`${item.id}-${pageInfo.id}-isolation-${encodeURIComponent(id)}`,"metrics.json"),JSON.stringify(record,null,2)+"\n");
            report.isolationRecords.push(record);
            if(index%10===0||index===targets.size-1)t.diagnostic(`${item.id}-${pageInfo.id}: isolated ${index+1}/${targets.size}`);
          }
          for(const node of requested)if(!unique.some(row=>row.id===node.id)&&!report.isolationRecords.some(record=>record.matrix===item.id&&record.page===pageInfo.id&&record.nodes.some(row=>row.id===node.id)))report.unmeasured.push({matrix:item.id,page:pageInfo.id,id:node.id,reasonCode:"NO_CAPTURE_INTERSECTION",reason:"No captured tile intersects this requested node"});
        }
        assert.deepEqual(f.errors,[],"no uncaught editor exceptions");assert.deepEqual(f.blocked,[],"offline fixture must not contact external origins");assert.equal(f.calls.filter(call=>call.method==="workspace.writeText").length,0,"read-only document never saved or recovered");
      }finally{await f.context.close();}
    }
  }finally{
    await browser.close();if(data.real)assert.equal(hash(await readFile(process.env.DESIGN_FIDELITY_REAL_FIXTURE)),data.inputHash,"private source bytes unchanged");
    report.rawUniqueRecords=selectUniqueMeasurements(report.records);report.uniqueRecords=selectUniqueMeasurements([...report.records,...report.isolationRecords]);
    report.countDefinitions={unit:"one (page,node,route,matrix), including the HTML reference self-comparison",truefail:"all unique rows with gateFailures, including html-pixel-snap exceptions",unclassifiedFail:"unique rows with gateFailures lacking sufficient html-pixel-snap classification; no raw failure is removed",htmlPixelSnap:"sufficient four-edge evidence for the named stroke geometry exception, never a pass; pixel failures remain",full:"complete chosen ROI, including isolation-full and explicitly derived isolation-full-composite",isolation:"chosen measurement came from the same four-route isolation transform; oversize nodes use raw same-scale tiles and a coverage-proven derived composite with copy-only provenance",unavailable:"primaryAvailable is false; inspect unavailableReasonCodes",raw:"unmodified tile PNGs and per-tile metrics in records; rawUniqueRecords chooses full tiles without applying isolation"};
    report.rawSummary=fidelityCounts(report.rawUniqueRecords);report.rawSummary.tileMeasurements=report.records.reduce((sum,record)=>sum+(record.nodes??[]).reduce((total,node)=>total+Object.keys(node.measurements).length,0),0);
    const routeFailures=[...report.records,...report.isolationRecords].flatMap(record=>record.routeErrors.map(error=>({matrix:record.matrix,page:record.page,tileIndex:record.tileIndex,...error})));
    report.failures.push(...routeFailures,...report.uniqueRecords.filter(row=>row.value.gateFailures.length).map(row=>({matrix:row.matrix,page:row.page,id:row.id,route:row.route,coverage:row.coverage,failures:row.value.gateFailures})));
    report.partialNodes=report.uniqueRecords.filter(row=>!row.complete).map(row=>({matrix:row.matrix,page:row.page,id:row.id,route:row.route,reasonCode:row.reasonCode,coverage:row.coverage}));
    const counts=fidelityCounts(report.uniqueRecords);
    report.summary={...counts,comparisons:report.records.length,isolationCaptures:report.isolationRecords.length,isolationRawTileCaptures:report.isolationTileRecords.length,compositeIsolations:report.isolationRecords.filter(record=>record.composite).length,failingChecks:report.failures.length,diagnosticFailures:counts.diagnosticFailures,diagnosticComparisons:counts.diagnostic,unavailablePrimary:counts.unavailable,unmeasured:report.unmeasured.length,partialNodes:report.partialNodes.length,fontOmissions:report.fontOmissions.length,allMeasuredThresholdsPassed:report.failures.length===0&&counts.diagnostic===0&&counts.unavailable===0&&report.unmeasured.length===0&&counts.partial===0&&counts.htmlPixelSnap===0&&report.fontOmissions.length===0,diagnosticModeDoesNotMeanPass:diagnostic};
    report.byMatrix=Object.fromEntries(matrix.map(item=>[item.id,fidelityCounts(report.uniqueRecords.filter(row=>row.matrix===item.id))]));
    report.byRoute=Object.fromEntries(["gpu","browser","svg","html"].map(route=>[route,fidelityCounts(report.uniqueRecords.filter(row=>row.route===route))]));
    await writeFile(join(output,"report.json"),JSON.stringify(report,null,2)+"\n");t.diagnostic(`EVIDENCE ${join(output,"report.json")} ${JSON.stringify(report.summary)}`);
  }
  if(!diagnostic){assert.equal(report.failures.length,0,`Fidelity candidate has ${report.failures.length} unique threshold/route failures; see ${join(output,"report.json")}`);assert.equal(report.unmeasured.length,0,"all requested text/stroke nodes require measurements");assert.equal(report.partialNodes.length,0,"partial tile geometry cannot establish complete-node parity");assert.equal(report.summary.unavailablePrimary,0,"unavailable primary metrics cannot establish parity");assert.equal(report.summary.diagnosticComparisons,0,"unresolved diagnostic comparisons cannot establish full parity");assert.equal(report.fontOmissions.length,0,"fallback diagnostics cannot certify an unavailable requested font");}
});
