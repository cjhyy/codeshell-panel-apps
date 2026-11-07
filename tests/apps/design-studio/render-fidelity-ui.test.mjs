import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { fidelityFontOmissions, renderFidelityFixture } from "./render-fidelity.fixture.mjs";
import { FIDELITY_THRESHOLDS, geometryDifference, inkGeometry, parseRgb, strokeContourScans, strokeRingPixelRegion, shapeGeometryFailures, shapePixelQualification, symmetricPixelDifference, textGeometryFailures } from "./render-fidelity.metrics.mjs";
import { rotationMomentRoi } from "./rotation-moment-roi.mjs";
import { compareGeometryProbe, compareRotationGeometry, coverageGeometry } from "./render-fidelity-geometry.mjs";
import { isolateFidelityDesign, selectUniqueMeasurements, classifyHtmlPixelSnap, classifyUnobservableOwnFill, classifySvgPreciseSnap, sameFloat32View, fidelityCounts, stitchFidelityTiles, fidelityIsolationPlan, attributeFrameComposite } from "./render-fidelity-attribution.mjs";

// The baseline directory must be an exact git archive. Both Node exports and
// browser modules are resolved there: a mixed old/new renderer is not a baseline.
const app = resolve(process.env.DESIGN_FIDELITY_APP_DIR ?? "apps/design-studio/app");
const load = name => import(pathToFileURL(join(app, name)));
const { normalizeDesignDocument, serializeDesignDocument, designPageBounds } = await load("document.mjs");
const { designFrontendCss } = await load("frontend-export.mjs");
const { designFontFaceCss } = await load("font-css.mjs");
const { textRangeSourceSignature } = await load("text-ranges.mjs");
const { createDesignResourcePersistencePlan } = await load("resource-store.mjs");
const { createDesignIndexPersistencePlan } = await load("document-index.mjs");
const { applyAllAutoLayouts } = await load("layout.mjs");
const { prepareBuiltinDesignFontResources } = await load("builtin-fonts.mjs");
const { browserPaintBoxes } = await load("canvas/browser-paint-box.mjs");
const origin = "https://render-fidelity.test", sourcePath = "designs/render-fidelity.codesign.json";
const output = resolve(process.env.DESIGN_FIDELITY_EVIDENCE ?? ".tmp/render-fidelity-r003/current");
const diagnostic = process.env.DESIGN_FIDELITY_MODE === "diagnostic";
const isolateAllText = process.env.DESIGN_FIDELITY_ISOLATE_TEXT === "1";
const targetIds = new Set((process.env.DESIGN_FIDELITY_TARGET_IDS??"").split(",").filter(Boolean));
const isolationOnly = process.env.DESIGN_FIDELITY_ISOLATION_ONLY === "1";
const captureRoutes = (process.env.DESIGN_FIDELITY_ROUTES ?? "gpu,browser,svg,html").split(",");
assert(captureRoutes.includes("gpu") && captureRoutes.includes("html") && captureRoutes.every(route=>["gpu","browser","svg","html"].includes(route)));
assert(!isolationOnly || targetIds.size, "isolation-only capture requires explicit targets");
const hash = value => createHash("sha256").update(typeof value === "string" || ArrayBuffer.isView(value) ? value : JSON.stringify(value)).digest("hex");
const matrix = [ {id:"dpr1-zoom1",dpr:1,zoom:1}, {id:"dpr2-zoom1",dpr:2,zoom:1}, {id:"dpr1-zoom2",dpr:1,zoom:2}, {id:"dpr1-zoom05",dpr:1,zoom:.5}, {id:"dpr2-zoom1-fractionalpan",dpr:2,zoom:1,deltaX:3.25}, {id:"dpr1-fit-view",dpr:1,zoom:1,fitView:true,diagnostic:true} ]
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
    const builtin=await prepareBuiltinDesignFontResources(design,{readBytes:url=>readFile(url),sha256Bytes:hash});
    for(const plan of builtin.resourcePlans)parts.push(...plan.parts);
    for(const face of builtin.faces)dataUrls.set(face.descriptor.id,`data:${face.descriptor.mime};base64,${Buffer.from(face.bytes).toString("base64")}`);
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
        const marker="return { setScene, resize, render, hitTest, dispose, stats };";
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
    window.addEventListener("wheel",event=>{window.__fidelityWheel={deltaX:event.deltaX,deltaY:event.deltaY,isTrusted:event.isTrusted,deltaMode:event.deltaMode};if(event.isTrusted)window.__fidelityTrustedWheelCount=(window.__fidelityTrustedWheelCount??0)+1;},{capture:true});
    const originalStrokeRect=CanvasRenderingContext2D.prototype.strokeRect;
    CanvasRenderingContext2D.prototype.strokeRect=function(x,y,width,height){if(this.canvas.id==="stage"&&this.strokeStyle==="#4f7cff"){const m=this.getTransform();window.__fidelityOverlay={x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f,width:m.a*width,height:m.d*height,matrix:{a:m.a,b:m.b,c:m.c,d:m.d,e:m.e,f:m.f}};}return originalStrokeRect.call(this,x,y,width,height);};
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
const isFillShape=node=>["frame","component","group","rectangle","ellipse"].includes(node.type)&&!(node.strokeWidth>0)&&!node.strokeSides&&Boolean(parseRgb(node.fill));
const isFillLeaf=(node,nodes)=>isFillShape(node)&&!nodes.some(child=>child.parentId===node.id);
const hasTextDescendants=(node,nodes)=>{const index=new Map(nodes.map(entry=>[entry.id,entry]));return nodes.some(child=>{if(child.type!=="text"||child.visible===false||child.opacity===0)return false;for(let parent=index.get(child.parentId),seen=new Set();parent&&!seen.has(parent.id);parent=index.get(parent.parentId)){if(parent.id===node.id)return true;seen.add(parent.id);}return false;});};
const isRequested=(node,nodes)=>node.visible!==false&&(node.type==="text"||node.strokeWidth>0||node.strokeSides||isFillShape(node));
function compareNodes(images,nodes,tile,item,canvas,real,{targetId,sourceNodes=nodes}={}) {
  const scale=item.dpr*item.zoom,rows=[],paintBoxes=browserPaintBoxes(nodes);
  for(const node of nodes){
    if(targetId&&node.id!==targetId)continue;
    if(!targetId&&targetIds.size&&!targetIds.has(node.id))continue;
    if(!isRequested(node,nodes)&&!["radius","rotation","shadow","shadow-stack","opacity","button-edge","selector-edge","clipped-child"].includes(node.id))continue;
    const fillLeaf=isFillShape(node),layoutBox=paintBoxes.layoutBoxes.get(node.id),rotationLocalLongEdgeCss=Math.max(
      Math.round(layoutBox?.width??Math.trunc(node.width*64)/64),Math.round(layoutBox?.height??Math.trunc(node.height*64)/64));
    const angle=(node.rotation??0)*Math.PI/180,inset=Math.max(8,(Math.abs(node.width*Math.cos(angle))+Math.abs(node.height*Math.sin(angle))-node.width)/2+4,(Math.abs(node.width*Math.sin(angle))+Math.abs(node.height*Math.cos(angle))-node.height)/2+4),clearance=Math.min(node.x-inset-tile.x,node.y-inset-tile.y,tile.x+tile.width-node.x-node.width-inset,tile.y+tile.height-node.y-node.height-inset),complete=clearance>=-1e-6;
    if(node.x+node.width<=tile.x||node.x>=tile.x+tile.width||node.y+node.height<=tile.y||node.y>=tile.y+tile.height)continue;
    const left=Math.max(node.x-inset,tile.x),top=Math.max(node.y-inset,tile.y),right=Math.min(node.x+node.width+inset,tile.x+tile.width),bottom=Math.min(node.y+node.height+inset,tile.y+tile.height);
    const roi={x:(left-tile.x)*scale,y:(top-tile.y)*scale,width:(right-left)*scale,height:(bottom-top)*scale},background=backgroundFor(node,nodes,canvas);
    let foreground=parseRgb(node.type==="text"||!(node.strokeWidth>0)?node.fill:node.stroke);
    if(node.type==="text"&&node.strokeWidth>0&&foreground&&background&&foreground.every((v,i)=>v===background[i]))foreground=parseRgb(node.stroke);
    const diagnosticReasons=[];
    if(Number.isFinite(node.layoutBaselineOffset))diagnosticReasons.push("FINITE_OFFSET_COMPATIBILITY_ONLY");
    if(node.rotation&&!fillLeaf)diagnosticReasons.push("ROTATED_AXIS_ALIGNED_INK_ROI");
    const sourceNode=sourceNodes.find(source=>source.id===node.id);
    const observability=sourceNode?classifyUnobservableOwnFill(sourceNode,sourceNodes,canvas):null;
    const ring=["frame","component","group"].includes(node.type)&&node.strokeWidth>0&&!node.rotation?
      strokeRingPixelRegion({bounds:{x:(node.x-tile.x)*scale,y:(node.y-tile.y)*scale,width:node.width*scale,height:node.height*scale},strokeWidth:node.strokeWidth*scale,strokeAlign:node.strokeAlign,cornerRadius:(node.cornerRadius??0)*scale}):null;
    const compositeContainer=["frame","component","group"].includes(node.type)&&nodes.some(child=>child.parentId===node.id);
    const measurements={};
    for(const route of captureRoutes){
      const image=images[route];
      if(!image||!images.html){measurements[route]={ink:null,primaryAvailable:false,unavailableReasonCodes:[!image?"ROUTE_CAPTURE_FAILED":"HTML_REFERENCE_MISSING"],failures:[],gateFailures:[],gating:"unavailable"};continue;}
      const rawCompositePixel=symmetricPixelDifference(images.html,image,{roi,retainMask:Boolean(ring||compositeContainer)}),pixel=ring?symmetricPixelDifference(images.html,image,{roi,includePixel:ring.includePixel}):rawCompositePixel,foregrounds=[foreground,...(node.textRanges?.ranges??[]).map(range=>parseRgb(range.fill))].filter(Boolean);
      const ink=foreground&&background?inkGeometry(image,{roi,foreground,foregrounds,background}):null;
      const value=measurements[route]={ink,pixel,cropSha256:hash(crop(image,roi)),unavailableReasonCodes:[]};
      if(fillLeaf)value.coverageGeometry=foreground&&background?coverageGeometry(image,{roi,foreground,background}):null;
      if(ring||compositeContainer)value.rawCompositePixel=rawCompositePixel;
      if(ring)value.pixelRegion=ring.metadata;
      value.geometryProbe=["shadow","shadow-stack"].includes(node.id)&&!node.shadow&&!node.shadowStack?null:compareGeometryProbe(images.html,image,{node,tile,scale});
      if(fillLeaf&&node.rotation)value.geometryProbe={kind:"rotation",...compareRotationGeometry(images.html,image,{roi,foreground,background,localLongEdgeCss:rotationLocalLongEdgeCss,scale})};
      if(node.strokeWidth>0&&node.type!=="text"&&!node.rotation){
        value.strokeEdges=strokeContourScans(image,{shape:node.type,bounds:{x:(node.x-tile.x)*scale,y:(node.y-tile.y)*scale,width:node.width*scale,height:node.height*scale},strokeWidth:node.strokeWidth*scale,strokeAlign:node.strokeAlign,cornerRadius:(node.cornerRadius??0)*scale,
          foreground:parseRgb(node.stroke)??[0,0,0],background:parseRgb(node.fill)??background??[255,255,255],outsideBackground:background??[255,255,255]});
      }
    }
    const strokeClassification=classifyHtmlPixelSnap({node,scale,measurements});
    for(const [route,value]of Object.entries(measurements)){
      if(!value.pixel)continue;
      value.delta=geometryDifference(measurements.html.ink,value.ink);value.failures=[];value.diagnosticFailures=[];
      if(fillLeaf&&node.rotation){
        value.rawWideRotationGeometry=value.geometryProbe;
        value.rotationMomentRoi=rotationMomentRoi({node,tile,scale,referenceInk:measurements.html.ink,actualInk:value.ink});
        value.geometryProbe=value.rotationMomentRoi?{kind:"rotation",...compareRotationGeometry(images.html,images[route],{roi:value.rotationMomentRoi,foreground,background,localLongEdgeCss:rotationLocalLongEdgeCss,scale})}:
          {kind:"rotation",measurable:false,failures:["bounded rotation ROI requires both primary ink bboxes"]};
      }
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
      if(node.strokeSides&&!(node.strokeWidth>0)){value.primaryAvailable=false;value.unavailableReasonCodes.push("ASYMMETRIC_STROKE_CONTOUR_UNSUPPORTED");}
      if(node.type==="text"&&!diagnosticReasons.length)value.failures.push(...textGeometryFailures(value.delta,{scale,align:node.textAlign}));
      if(fillLeaf&&!node.rotation)value.failures.push(...shapeGeometryFailures(value.delta));
      if(value.strokeEdges&&measurements.html.strokeEdges){
        value.strokeDeltas=value.strokeEdges.probes.flatMap(probe=>{const reference=measurements.html.strokeEdges.probes.find(other=>other.edge===probe.edge&&other.fraction===probe.fraction);return reference?[{edge:probe.edge,fraction:probe.fraction,centroid:probe.centroid-reference.centroid,width:probe.width-reference.width}]:[];});
        const actualIndexes=value.strokeEdges.probes.map(probe=>probe.index),referenceIndexes=measurements.html.strokeEdges.probes.map(probe=>probe.index);
        value.strokeContourCoverage={matched:value.strokeDeltas.length,referenceVisible:referenceIndexes.length,actualVisible:actualIndexes.length,excludedReference:measurements.html.strokeEdges.unavailable,excludedActual:value.strokeEdges.unavailable};
        if(value.strokeDeltas.length<16||actualIndexes.some(index=>!referenceIndexes.includes(index))||referenceIndexes.some(index=>!actualIndexes.includes(index))){value.primaryAvailable=false;value.unavailableReasonCodes.push("STROKE_CONTOUR_VISIBILITY_MISMATCH_OR_TOO_FEW_MATCHED");}
        for(const delta of value.strokeDeltas){
          if(Math.abs(delta.centroid)>.35)value.failures.push(`stroke ${delta.edge}@${delta.fraction} centroid ${delta.centroid} > .35`);
          if(Math.abs(delta.width)>.35)value.failures.push(`stroke ${delta.edge}@${delta.fraction} width ${delta.width} > .35`);
        }
        if(strokeClassification&&["gpu","svg"].includes(route))value.strokeClassification=strokeClassification;
      }
      const geometryFailures=[...value.failures];value.geometryFailures=geometryFailures;
      value.geometryScope=node.strokeSides&&!(node.strokeWidth>0)?"unsupported-asymmetric-stroke":fillLeaf?(isFillLeaf(node,nodes)?"own-fill-leaf":"visible-composite-fill-with-descendant-occlusion"):value.strokeEdges?"visible-stroke-contour":value.geometryProbe?.kind??"unmeasured";
      const completeShapeGeometry=value.geometryScope!=="unmeasured"&&value.geometryScope!=="unsupported-asymmetric-stroke";
      if(node.type!=="text")value.pixelQualification=shapePixelQualification(images.html,images[route],{roi,includePixel:ring?.includePixel,geometryPassed:completeShapeGeometry&&value.primaryAvailable&&geometryFailures.length===0,containsText:hasTextDescendants(node,nodes)});
      const testedPixel=value.pixelQualification?.qualified?value.pixelQualification.refined:value.pixel;
      const maximum=node.type==="text"?.005:.001,pixelFailures=[];
      if(testedPixel.mismatchRatio>maximum)pixelFailures.push(`pixel mismatch ${testedPixel.mismatchRatio} > ${maximum}`);
      if(testedPixel.largestCluster>6)pixelFailures.push(`pixel cluster ${testedPixel.largestCluster} > 6`);
      value.failures.push(...pixelFailures);
      // CC permits SVG text pixels and every half-zoom metric as diagnostics;
      // SVG text geometry at the three primary matrices remains strict.
      value.gating=item.diagnostic||item.zoom===.5||diagnosticReasons.length&&!value.geometryProbe?.measurable?"diagnostic":"primary-and-secondary";
      value.gateFailures=value.gating==="diagnostic"?[]:route==="svg"&&node.type==="text"?value.failures.filter(reason=>!reason.startsWith("pixel")):value.failures;
      if(value.gating==="diagnostic")value.diagnosticFailures=[...value.failures];
      else if(route==="svg"&&node.type==="text")value.diagnosticFailures=pixelFailures;
      if(observability){value.observability=observability;value.unavailableReasonCodes=[...new Set([...value.unavailableReasonCodes,"OWN_FILL_UNOBSERVABLE"])];}
    }
    const snappedNode=paintBoxes.fallbackReasons.has(node.id)?null:paintBoxes.nodes.get(node.id);
    const svgSnapClassification=classifySvgPreciseSnap({node,snappedNode,rotationPivot:paintBoxes.rotationPivots?.get(node.id),scale,measurements,tile});
    if(svgSnapClassification){const value=measurements.svg;value.preSvgSnapGateFailures=[...value.gateFailures];value.svgSnapClassification=svgSnapClassification;value.gating="diagnostic";value.gateFailures=[];value.diagnosticFailures=[...value.failures];}
    rows.push({id:node.id,type:node.type,fillRole:fillLeaf?(isFillLeaf(node,nodes)?"painted-fill-leaf":"painted-fill-container-with-descendants"):null,complete,clearance,partialReasonCode:complete?null:"TILE_TRUNCATED",geometry:{x:node.x,y:node.y,width:node.width,height:node.height},diagnosticReasons,measurements});
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
const cameraView=page=>page.locator("#stage").evaluate(canvas=>{const m=canvas.getContext("2d").getTransform(),box=canvas.getBoundingClientRect();return{zoom:m.a/devicePixelRatio,panX:m.e/devicePixelRatio,panY:m.f/devicePixelRatio,left:box.left,top:box.top,width:box.width,height:box.height,dpr:devicePixelRatio};});
async function captureRecord({f,design,data,item,tile,tileIndex,folder,svg,stageStyle,bounds,isolation=null,gui=false}) {
  await mkdir(folder,{recursive:true});
  const record={matrix:item.id,page:design.activePageId,tileIndex,tile,scale:item.dpr*item.zoom,actualFitView:item.actualFitView??null,paths:{},routeErrors:[],calibration:{},isolation};
  const images={},clip={x:32,y:32,width:Math.round(tile.width*item.zoom),height:Math.round(tile.height*item.zoom)},page=f.page;
  // Establish one camera before switching routes. CDP may internally deliver
  // adjacent float32 wheel deltas on separate sends even when DOM reports 3.25.
  // Every page/matrix therefore owns one trusted challenge. Later tiles and
  // paint-only isolation reuse its measured displacement; they never resend it.
  await page.locator("#renderer-mode").selectOption("gpu");await rendererReady(page,"gpu");
  if(gui){await f.chromeStyle.evaluate(element=>element.remove());await frames(page);}
  const priorChallenge=f.cameraChallenge;
  record.view=await align(page,priorChallenge?{...tile,x:tile.x+priorChallenge.actualDeltaX/item.zoom}:tile,item.zoom);
  if(item.deltaX&&!priorChallenge){
    const before={...record.view},box=await page.locator("#stage").boundingBox();
    await page.mouse.move(box.x+Math.min(200,box.width/2),box.y+Math.min(200,box.height/2));await page.mouse.wheel(item.deltaX*item.dpr,0);
    await page.waitForFunction(({before,delta})=>Math.abs(document.querySelector("#stage").getContext("2d").getTransform().e/devicePixelRatio-before+delta)<.01,{before:before.panX,delta:item.deltaX},{timeout:1500});await frames(page);
    record.view=await cameraView(page);
    f.cameraChallenge={requestedDomDeltaX:item.deltaX,cdpInputDeltaX:item.deltaX*item.dpr,event:await page.evaluate(()=>window.__fidelityWheel),before,after:record.view,actualDeltaX:before.panX-record.view.panX,noPostChallengeAlignment:true,sourceTileIndex:tileIndex};
    assert(f.cameraChallenge.event.isTrusted&&f.cameraChallenge.event.deltaX===item.deltaX,"trusted DOM wheel must contain the requested CSS delta");
    assert(Math.abs(record.view.panX-before.panX+item.deltaX)<.01,`real fractional wheel input must survive without corrective alignment: ${JSON.stringify(f.cameraChallenge)}`);
  }
  if(gui){
    for(const mode of ["gpu","browser"]){
      await page.locator("#renderer-mode").selectOption(mode);await rendererReady(page,mode);await page.waitForTimeout(175);await frames(page);
      const view=await cameraView(page),challenge=f.cameraChallenge;
      const receipt={matrix:item.id,page:design.activePageId,route:mode,requestedZoom:item.fitView?null:item.zoom,view,challenge,
        source:item.fitView?"actual fit scale with shared metric-tile camera in normal workbench":"named matrix zoom and one shared trusted wheel in normal workbench",path:join(folder,`${mode}-editor-gui.png`)};
      (record.guiViews??={})[mode]=receipt;
      if(mode==="browser")assert(sameFloat32View(record.guiViews.gpu.view,view),"GUI GPU/browser cameras must be float32-equivalent");
      await page.screenshot({path:receipt.path});await writeFile(join(folder,`${mode}-editor-gui.metadata.json`),JSON.stringify(receipt,null,2)+"\n");
    }
    f.chromeStyle=await page.addStyleTag({content:stageStyle});await frames(page);
  }
  record.cameraPolicy={trustedChallengeReused:Boolean(priorChallenge),trustedWheelSentHere:Boolean(item.deltaX&&!priorChallenge),sameEditorLoad:true};
  let measuredTile=tile;
  for(const mode of ["gpu","browser"].filter(route=>captureRoutes.includes(route))){
    try{
      await page.locator("#renderer-mode").selectOption(mode);await rendererReady(page,mode);
      record.view=await cameraView(page);
      if(item.deltaX)(record.trackpad??={})[mode]={...f.cameraChallenge,reusedForTile:Boolean(priorChallenge),captureView:record.view};
      measuredTile={...tile,x:(32-record.view.panX)/item.zoom,y:(32-record.view.panY)/item.zoom};record.tile=measuredTile;
      (record.routeViews??={})[mode]={...record.view};
      if(mode==="browser"&&record.routeViews.gpu)assert(sameFloat32View(record.routeViews.gpu,record.view),"actual GPU/browser transforms must be float32-equivalent");
      // The actual mounted editor renderer receives the exact same transformed
      // document as the exports. Resource bytes are its existing owned resources.
      await page.evaluate(async({mode,design,view})=>{
        await window[mode==="gpu"?"__fidelityGpuScene":"__fidelityBrowserScene"](design);
        window[mode==="gpu"?"__fidelityGpuRender":"__fidelityBrowserRender"]({pan:{x:view.panX,y:view.panY},zoom:view.zoom});
        await document.fonts.ready;
      },{mode,design,view:record.view});await page.waitForTimeout(175);await frames(page);
      if((item.deltaX||item.fitView)&&!isolation&&gui){
        const target=design.nodes.find(node=>node.type==="text"&&!node.rotation&&!node.parentId&&node.x>=measuredTile.x&&node.y>=measuredTile.y&&node.x+node.width<measuredTile.x+measuredTile.width&&node.y+node.height<measuredTile.y+measuredTile.height);
        if(target){
          await page.evaluate(()=>{window.__fidelityOverlay=null;});
          await page.mouse.click(record.view.left+record.view.panX+(target.x+target.width/2)*item.zoom,record.view.top+record.view.panY+(target.y+target.height/2)*item.zoom);await frames(page);
          const proof=await page.evaluate(async()=>({selection:(await tools.get_design_metadata({})).selection,overlay:window.__fidelityOverlay}));
          const expected={x:(record.view.panX+target.x*item.zoom)*item.dpr,y:(record.view.panY+target.y*item.zoom)*item.dpr,width:target.width*item.zoom*item.dpr,height:target.height*item.zoom*item.dpr};
          proof.targetId=target.id;proof.expected=expected;proof.maximumDeviceDelta=proof.overlay?Math.max(...Object.keys(expected).map(key=>Math.abs(expected[key]-proof.overlay[key]))):null;
          proof.passed=proof.selection.includes(target.id)&&proof.maximumDeviceDelta!==null&&proof.maximumDeviceDelta<=.5;
          const overlayStyle=await page.addStyleTag({content:"#stage{opacity:1!important}"});await page.screenshot({path:join(folder,`${mode}-fractional-selection.png`)});await overlayStyle.evaluate(element=>element.remove());
          (record.interactionProof??={})[mode]=proof;if(!proof.passed)record.routeErrors.push({route:mode,reasonCode:"FRACTIONAL_INTERACTION_MISMATCH",error:JSON.stringify(proof)});
        }else (record.interactionProof??={})[mode]={passed:false,reasonCode:"NO_TOP_LEVEL_TEXT_INTERACTION_TARGET",explicitlyUncovered:true};
      }
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
  const css=designFrontendCss(design,{resourceDataUrls:data.dataUrls,preserveWorldOrigin:true});
  for(const route of ["html","svg"].filter(route=>captureRoutes.includes(route))){
    if(route==="svg"&&!svg){record.routeErrors.push({route,reasonCode:"SVG_EXPORT_FAILED"});continue;}
    const ref=await f.context.newPage();
    try{
      const content=route==="html"?"":svg.replace("<svg ",`<svg style="position:absolute;left:${bounds.x}px;top:${bounds.y}px" `),styles=route==="html"?css:designFontFaceCss(design.resources,data.dataUrls),url=`/fidelity-${route}.html`;
      f.routes.set(url,`<!doctype html><meta charset="utf-8"><style>${styles}\nhtml,body{margin:0;background:${design.canvas.background};overflow:hidden}#export-world{position:absolute;left:32px;top:32px;width:${Math.max(design.canvas.width,bounds.width)}px;transform-origin:0 0;transform:scale(${item.zoom}) translate(${-measuredTile.x}px,${-measuredTile.y}px)}.cs-page{margin:0!important;overflow:visible!important}</style><div id="export-world">${content}</div>`);
      await ref.goto(origin+url);
      if(route==="html"&&isolationOnly){
        const original={...data.design,activePageId:design.activePageId,nodes:data.design.pages.find(page=>page.id===design.activePageId).nodes};
        record.referenceDom=await ref.evaluate(async({original,dataUrls,css})=>{
          const {renderDesignFrontendPage}=await import("/frontend-export.mjs");
          const style=document.createElement("style");style.textContent=css;document.head.append(style);
          document.querySelector("#export-world").innerHTML=renderDesignFrontendPage(original,{resourceDataUrls:new Map(dataUrls),preserveWorldOrigin:true});
          for(const node of original.nodes.filter(node=>node.type==="text"&&node.opacity!==0))await document.fonts.load(`${node.fontWeight} ${node.fontSize}px ${node.fontFamily}`,node.text);
          await document.fonts.ready;
          const boxes=[...document.querySelectorAll("[data-codeshell-id]")].map(element=>{const box=element.getBoundingClientRect();return{id:element.dataset.codeshellId,x:box.x,y:box.y,width:box.width,height:box.height};});
          style.remove();return boxes;
        },{original,dataUrls:[...data.dataUrls],css:designFrontendCss(original,{resourceDataUrls:data.dataUrls,preserveWorldOrigin:true})});
      }
      if(route==="html")await ref.evaluate(async({design,dataUrls})=>{
        for(const node of design.nodes.filter(node=>node.type==="text"&&node.opacity!==0))await document.fonts.load(`${node.fontWeight} ${node.fontSize}px ${node.fontFamily}`,node.text);
        await document.fonts.ready;
        const {renderDesignFrontendPage}=await import("/frontend-export.mjs");
        document.querySelector("#export-world").innerHTML=renderDesignFrontendPage(design,{resourceDataUrls:new Map(dataUrls),preserveWorldOrigin:true});
      },{design,dataUrls:[...data.dataUrls]});
      await ref.evaluate(()=>document.fonts.ready);await frames(ref);
      const bytes=await ref.screenshot({clip,path:join(folder,`${route}.png`)});images[route]=PNG.sync.read(bytes);record.paths[route]=join(folder,`${route}.png`);
      if(route==="html"){
        const repeat=PNG.sync.read(await ref.screenshot({clip,path:join(folder,"html-repeat.png")}));record.calibration.html=symmetricPixelDifference(images.html,repeat);assert.equal(record.calibration.html.mismatchPixels,0,"HTML/HTML calibration must be zero");
        record.dom=await ref.locator("[data-codeshell-id]").evaluateAll(elements=>elements.map(element=>{const box=element.getBoundingClientRect();return{id:element.dataset.codeshellId,x:box.x,y:box.y,width:box.width,height:box.height,font:getComputedStyle(element).font};}));
      }
    }catch(error){record.routeErrors.push({route,reasonCode:"ROUTE_CAPTURE_FAILED",error:String(error)});}finally{await ref.close();}
  }
  record.nodes=compareNodes(images,design.nodes,measuredTile,item,design.canvas,data.real,{targetId:isolation?.targetId,sourceNodes:data.design.pages.find(page=>page.id===design.activePageId)?.nodes??data.design.nodes});
  if(images.html){
    const sheetLeft=Math.max(bounds.x,measuredTile.x),sheetTop=Math.max(bounds.y,measuredTile.y),sheetRight=Math.min(bounds.x+bounds.width,measuredTile.x+measuredTile.width),sheetBottom=Math.min(bounds.y+bounds.height,measuredTile.y+measuredTile.height),scale=item.dpr*item.zoom;
    record.wholeImageRoi={x:(sheetLeft-measuredTile.x)*scale,y:(sheetTop-measuredTile.y)*scale,width:(sheetRight-sheetLeft)*scale,height:(sheetBottom-sheetTop)*scale};
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
  const first=tileRecords[0],scale=item.dpr*item.zoom,effectiveFull={...full,x:full.x+first.tile.x-segments[0].x,y:full.y+first.tile.y-segments[0].y},record={matrix:item.id,page:design.activePageId,tileIndex:options.tileIndex,tile:effectiveFull,scale,
    isolation,paths:{},view:first.view,dom:first.dom,referenceDom:first.referenceDom,gpu:first.gpu,chromeProof:first.chromeProof,
    routeErrors:tileRecords.flatMap((entry,tileIndex)=>entry.routeErrors.map(error=>({...error,tileIndex}))),
    calibration:{rawTiles:tileRecords.map(entry=>({tileIndex:entry.tileIndex,...entry.calibration}))},
    composite:{kind:"derived-same-coordinate-pixel-stitch",singleScreenshot:false,sourceMetrics:segments.map((_,index)=>join(folder,`tile-${index}`,"metrics.json")),routes:{}}};
  const images={};
  for(const route of captureRoutes){
    try{
      const sources=[];
      for(const entry of tileRecords){
        if(!entry.paths[route])throw Object.assign(Error(`Missing ${route} raw isolation tile`),{code:"COMPOSITE_ROUTE_TILE_MISSING"});
        const bytes=await readFile(entry.paths[route]);sources.push({image:PNG.sync.read(bytes),tile:entry.tile,source:entry.paths[route],sourceSha256:hash(bytes)});
      }
      const stitched=stitchFidelityTiles(sources,{bounds:effectiveFull,scale}),png=new PNG({width:stitched.image.width,height:stitched.image.height});png.data=Buffer.from(stitched.image.data);
      const bytes=PNG.sync.write(png),path=join(folder,`derived-composite-${route}.png`);await writeFile(path,bytes);
      record.paths[route]=path;record.composite.routes[route]={...stitched.provenance,outputSha256:hash(bytes),outputPath:path};images[route]=png;
    }catch(error){record.routeErrors.push({route,reasonCode:error.code??"COMPOSITE_BUILD_FAILED",error:String(error)});}
  }
  record.nodes=compareNodes(images,design.nodes,effectiveFull,item,design.canvas,options.data.real,{targetId:isolation.targetId,sourceNodes:options.data.design.pages.find(page=>page.id===design.activePageId)?.nodes??options.data.design.nodes});
  await writeFile(join(folder,"metrics.json"),JSON.stringify(record,null,2)+"\n");return {record,tileRecords};
}

// Six real pages retain raw, isolated and unique receipts. Serialize the large
// top-level arrays one entry at a time so a report never requires one enormous
// JavaScript string. Values and receipt order are unchanged.
async function writeFidelityReport(path,report) {
  const file=await open(path,"w");
  try{
    await file.writeFile("{\n");
    const entries=Object.entries(report);
    for(const [index,[key,value]]of entries.entries()){
      await file.writeFile(`${index?",\n":""}  ${JSON.stringify(key)}: `);
      if(Array.isArray(value)){
        await file.writeFile("[\n");
        for(const [itemIndex,item]of value.entries())await file.writeFile(`${itemIndex?",\n":""}${JSON.stringify(item)}`);
        await file.writeFile("\n  ]");
      }else await file.writeFile(JSON.stringify(value));
    }
    await file.writeFile("\n}\n");
  }finally{await file.close();}
}

test("B0 four-route actual-editor fidelity matrix (strict by default)",{timeout:3600000},async t=>{
  await mkdir(output,{recursive:true});const data=await dataset(),report={schema:4,mode:diagnostic?"diagnostic":"strict",capturePolicy:{isolateAllText,isolationOnly,captureRoutes,targetIds:[...targetIds]},sourceApp:app,real:data.real,inputSha256:data.inputHash,serializedSha256:data.serializedHash,thresholds:FIDELITY_THRESHOLDS,matrix,viewport:{width:1600,height:1000},launchArgs:["--enable-webgl","--enable-unsafe-swiftshader","--use-angle=swiftshader"],records:[],isolationRecords:[],isolationTileRecords:[],uniqueRecords:[],failures:[],unmeasured:[],partialNodes:[],finiteCompatibility:[],fontAvailability:[],fontOmissions:[],environment:{platform:process.platform,arch:process.arch,node:process.version}};
  const includedIds=new Set(data.design.pages.filter(page=>!process.env.DESIGN_FIDELITY_PAGES||process.env.DESIGN_FIDELITY_PAGES.split(",").includes(page.id)).flatMap(page=>page.nodes.map(node=>node.id)));
  assert([...targetIds].every(id=>includedIds.has(id)),"every explicit target must exist in the selected pages");
  report.fillInventory=data.design.pages.map(page=>{const candidates=page.nodes.filter(node=>node.type!=="text"&&!(node.strokeWidth>0)&&!node.strokeSides);return{page:page.id,noStrokeNontext:candidates.length,paintedLeaves:candidates.filter(node=>isFillLeaf(node,page.nodes)).map(node=>node.id),paintedContainers:candidates.filter(node=>isFillShape(node)&&!isFillLeaf(node,page.nodes)).map(node=>node.id),noOwnSolidFill:candidates.filter(node=>!isFillShape(node)).map(node=>({id:node.id,type:node.type,fill:node.fill,reason:"no own solid fill ink; structural container/descendant semantics are not a fabricated fill metric"}))};});
  const browser=await chromium.launch({headless:true,args:report.launchArgs});report.environment.chromium=browser.version();
  try{
    for(const item of matrix){
      const f=await editor(browser,item,data),page=f.page;
      try{
        const fonts=await page.evaluate(async()=>{await document.fonts.ready;const ctx=document.createElement("canvas").getContext("2d"),sample="HMI 中文 AV";const width=family=>{ctx.font=`20px ${family}`;return ctx.measureText(sample).width;};return Promise.all(["Arial","PingFang SC","system-ui","Fidelity Inter","Inter"].map(async family=>{let localFace=false,localName=null;for(const name of [family,...(family==="PingFang SC"?["PingFangSC-Regular"]:[])])try{await new FontFace("AvailabilityProbe",`local("${name}")`).load();localFace=true;localName=name;break;}catch{}return{family,fontCheck:document.fonts.check(`20px "${family}"`),localFace,localName,width:width(`"${family}",monospace`),fallbackWidth:width("monospace"),available:family==="system-ui"||localFace};}));});
        for(const font of fonts)if(data.design.resources.some(resource=>resource.kind==="font"&&resource.family===font.family)){font.resourceProvided=true;font.available=true;}
        report.fontAvailability.push({matrix:item.id,fonts});
        report.fontOmissions.push(...fidelityFontOmissions(fonts,data.design.pages.filter(page=>!process.env.DESIGN_FIDELITY_PAGES||process.env.DESIGN_FIDELITY_PAGES.split(",").includes(page.id))).map(omission=>({matrix:item.id,...omission})));
        await page.screenshot({path:join(output,`${item.id}-editor-gui.png`)});
        report.chromeExclusion="Comparison crops reserve a 1600x1000 stage, hide #stage interaction/labels with opacity:0, and use canvas.background behind the transparent GPU surface. Only while capturing comparison PNGs, direct-child canvas-meta, infinite-canvas-hint, renderer-message, selection-size and inline-text-editor have visibility:hidden. Actual GUI screenshots and renderer controls restore all editor chrome. No design content is hidden.";
        report.isolationContract="Only isolationRecords apply the same immutable scene transform through actual GPU and browser setScene and both exports. Non-target sibling paint is hidden via opacity-zero layout placeholders; target descendants retain their paint/occlusion, with ancestor fills, original opacity, clip, transforms and layout retained. Raw full-scene PNGs and records are preserved.";
        const captureSelectors=chromeSelectors.map(selector=>`#stage-wrap[data-fidelity-capture="true"] > ${selector}`).join(","),stageStyle=`#stage-wrap{position:fixed!important;inset:0!important;width:1600px!important;height:1000px!important;z-index:10000!important;border:0!important;border-radius:0!important;background:${data.design.canvas.background}!important}#stage{opacity:0!important}${captureSelectors}{visibility:hidden!important}`;
        f.chromeStyle=await page.addStyleTag({content:stageStyle});await frames(page);
        for(const pageInfo of data.design.pages){
          if(process.env.DESIGN_FIDELITY_PAGES&&!process.env.DESIGN_FIDELITY_PAGES.split(",").includes(pageInfo.id))continue;
          if(targetIds.size&&!pageInfo.nodes.some(node=>targetIds.has(node.id)))continue;
          f.cameraChallenge=null;
          const trustedWheelStart=await page.evaluate(()=>window.__fidelityTrustedWheelCount??0);
          await page.locator("#active-page").selectOption(pageInfo.id);await page.waitForFunction(async id=>(await tools.get_design_metadata({})).activePageId===id,pageInfo.id);
          const design=normalizeDesignDocument(JSON.parse(serializeDesignDocument(data.design)));design.activePageId=pageInfo.id;design.nodes=design.pages.find(p=>p.id===pageInfo.id).nodes;
          const bounds=designPageBounds(design),captureBounds={x:Math.floor(bounds.x)-12,y:Math.floor(bounds.y)-12,width:Math.ceil(bounds.x+bounds.width)-Math.floor(bounds.x)+24,height:Math.ceil(bounds.y+bounds.height)-Math.floor(bounds.y)+24},pageItem={...item};
          let pageTiles=isolationOnly?[]:tiles(captureBounds,item.zoom);
          if(item.fitView){
            await f.chromeStyle.evaluate(element=>element.remove());await frames(page);
            await page.locator("#renderer-mode").selectOption("gpu");await rendererReady(page,"gpu");await page.locator("#zoom-value").click();await frames(page);
            const view=await page.locator("#stage").evaluate(canvas=>{const m=canvas.getContext("2d").getTransform(),box=canvas.getBoundingClientRect();return{zoom:m.a/devicePixelRatio,panX:m.e/devicePixelRatio,panY:m.f/devicePixelRatio,width:box.width,height:box.height};});
            const paths={};for(const mode of ["gpu","browser"]){await page.locator("#renderer-mode").selectOption(mode);await rendererReady(page,mode);paths[mode]=join(output,`${item.id}-${pageInfo.id}-${mode}-actual-fit-gui.png`);await page.screenshot({path:paths[mode]});}
            (report.fitViews??=[]).push({matrix:item.id,page:pageInfo.id,view,paths,source:"actual fitCanvas button in normal editor layout; no alignment before GUI capture",diagnostic:true});
            pageItem.zoom=view.zoom;pageItem.actualFitView=view;pageTiles=[{x:-view.panX/view.zoom,y:-view.panY/view.zoom,width:Math.min(1536,view.width)/view.zoom,height:Math.min(936,view.height)/view.zoom}];
            f.chromeStyle=await page.addStyleTag({content:stageStyle});await frames(page);
          }
          let svg;if(captureRoutes.includes("svg"))try{svg=await measuredSvg(f,design,data);}catch(error){report.failures.push({matrix:item.id,page:pageInfo.id,route:"svg",reasonCode:"SVG_EXPORT_FAILED",error:String(error)});}
          if(svg)for(const node of design.nodes.filter(n=>Number.isFinite(n.layoutBaselineOffset))){
            const parsed=await page.evaluate(({svg,id})=>{const doc=new DOMParser().parseFromString(svg,"image/svg+xml");return doc.querySelector(`[data-node-id="${CSS.escape(id)}"]`)?.outerHTML??null;},{svg,id:node.id});
            report.finiteCompatibility.push({matrix:item.id,page:pageInfo.id,id:node.id,svg:parsed,svgSha256:hash(parsed??"")});
          }
          const raw=[];
          for(const [tileIndex,tile]of pageTiles.entries()){
            const key=`${item.id}-${pageInfo.id}-${tileIndex}`,record=await captureRecord({f,design,data,item:pageItem,tile,tileIndex,folder:join(output,key),svg,stageStyle,bounds,gui:tileIndex===0});
            raw.push(record);report.records.push(record);t.diagnostic(`${key}: raw ${record.nodes.length} nodes, ${record.routeErrors.length} route errors`);
          }
          const unique=selectUniqueMeasurements(raw),requested=design.nodes.filter(node=>isRequested(node,design.nodes)&&(!targetIds.size||targetIds.has(node.id))),
            isolationPlan=raw.some(record=>record.routeErrors.length)?[]:targetIds.size?requested.map(node=>({id:node.id,reasonCodes:["EXPLICIT_SINGLE_NODE_ISOLATION_AUDIT"]})):item.fitView?[]:fidelityIsolationPlan(unique,requested,{isolateAllText}),targets=new Set(isolationPlan.map(entry=>entry.id));
          // Isolate every failed/unavailable raw target using a shared scene;
          // this is mandatory, not a switch which can silently certify raw ROIs.
          for(const [index,id]of [...targets].entries()){
            const isolated=isolateFidelityDesign(design,id),node=isolated.design.nodes.find(node=>node.id===id),tile=isolationBounds(node,pageItem.zoom),isolatedBounds=designPageBounds(isolated.design);
            if(item.fitView&&raw[0]){
              // Crop translation is an integer device-pixel displacement from
              // the actual fit receipt; preserve its text sampling phase.
              const scale=item.dpr*pageItem.zoom,reference=raw[0].tile;
              tile.x=reference.x+Math.floor((tile.x-reference.x)*scale)/scale;
              tile.y=reference.y+Math.floor((tile.y-reference.y)*scale)/scale;
            }
            let isolatedSvg;if(captureRoutes.includes("svg"))try{isolatedSvg=await measuredSvg(f,isolated.design,data);}catch(error){isolated.metadata.svgError=String(error);}
            const {record,tileRecords}=await captureIsolation({f,design:isolated.design,data,item:pageItem,tile,tileIndex:`isolation-${index}`,folder:join(output,`${item.id}-${pageInfo.id}-isolation-${encodeURIComponent(id)}`),svg:isolatedSvg,stageStyle,bounds:isolatedBounds,isolation:{...isolated.metadata,triggerReasons:isolationPlan.find(entry=>entry.id===id).reasonCodes}});
            // Stroke/shadow separation is an additional render of the same
            // isolated scene. Original pixels and the independent shadow probe
            // remain authoritative for the combined image.
            if(node.strokeWidth>0&&(node.shadow||node.shadowStack)){
              const strokeScene=isolateFidelityDesign(design,id,{strokeOnly:true});
              const strokeSvg=await measuredSvg(f,strokeScene.design,data);
              const strokeFolder=join(output,`${item.id}-${pageInfo.id}-isolation-${encodeURIComponent(id)}`,"stroke-only");
              const strokeCapture=await captureIsolation({f,design:strokeScene.design,data,item:pageItem,tile,tileIndex:`stroke-only-${index}`,folder:strokeFolder,svg:strokeSvg,stageStyle,bounds:designPageBounds(strokeScene.design),isolation:strokeScene.metadata});
              record.strokeOnly={metrics:join(strokeFolder,"metrics.json"),paths:strokeCapture.record.paths,routeErrors:strokeCapture.record.routeErrors,shadowRemovedOnlyFromAdditionalCapture:true};
              record.routeErrors.push(...strokeCapture.record.routeErrors);
              for(const entry of record.nodes)for(const [route,value]of Object.entries(entry.measurements)){
                const stroke=strokeCapture.record.nodes.find(other=>other.id===entry.id)?.measurements[route];
                if(!stroke)continue;
                value.originalCombinedStroke={strokeEdges:value.strokeEdges,strokeDeltas:value.strokeDeltas,strokeContourCoverage:value.strokeContourCoverage,primaryAvailable:value.primaryAvailable,unavailableReasonCodes:[...value.unavailableReasonCodes],geometryFailures:[...value.geometryFailures]};
                for(const field of ["strokeEdges","strokeDeltas","strokeContourCoverage"])value[field]=stroke[field];
                const strokeFailures=(stroke.geometryFailures??[]).filter(reason=>reason.startsWith("stroke "));
                value.geometryFailures=[...(value.geometryProbe?.failures??[]),...strokeFailures];
                value.failures=[...value.geometryFailures,...value.failures.filter(reason=>reason.startsWith("pixel"))];
                value.primaryAvailable=Boolean(stroke.primaryAvailable&&(!value.geometryProbe||value.geometryProbe.measurable));
                value.unavailableReasonCodes=value.primaryAvailable?[]:[...new Set([...(stroke.unavailableReasonCodes??[]),...(!value.geometryProbe?.measurable&&value.geometryProbe?["GEOMETRY_PROBE_UNAVAILABLE"]:[])])];
                value.strokeOnlyEvidence={metrics:record.strokeOnly.metrics,route,shadowMetricRetained:Boolean(value.geometryProbe),combinedPixelsRetained:true};
                value.gateFailures=value.gating==="diagnostic"?[]:[...value.failures];
                if(value.gating==="diagnostic")value.diagnosticFailures=[...value.failures];
              }
            }
            report.isolationTileRecords.push(...tileRecords);
            const rawDom=raw.find(entry=>entry.dom?.some(node=>node.id===id))??(record.referenceDom?{...record,dom:record.referenceDom}:null);
            const worldBox=(entry,dom)=>({x:(dom.x-32)/pageItem.zoom+entry.tile.x,y:(dom.y-32)/pageItem.zoom+entry.tile.y,width:dom.width/pageItem.zoom,height:dom.height/pageItem.zoom});
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
          const trustedWheelCount=(await page.evaluate(()=>window.__fidelityTrustedWheelCount??0))-trustedWheelStart;
          (report.cameraChallenges??=[]).push({matrix:item.id,page:pageInfo.id,trustedWheelCount,expected:item.deltaX?1:0});
          assert.equal(trustedWheelCount,item.deltaX?1:0,"each page/matrix applies the trusted wheel once and shares its camera across renderers");
          for(const node of requested)if(!unique.some(row=>row.id===node.id)&&!report.isolationRecords.some(record=>record.matrix===item.id&&record.page===pageInfo.id&&record.nodes.some(row=>row.id===node.id)))report.unmeasured.push({matrix:item.id,page:pageInfo.id,id:node.id,reasonCode:"NO_CAPTURE_INTERSECTION",reason:"No captured tile intersects this requested node"});
        }
        assert.deepEqual(f.errors,[],"no uncaught editor exceptions");assert.deepEqual(f.blocked,[],"offline fixture must not contact external origins");assert.equal(f.calls.filter(call=>call.method==="workspace.writeText").length,0,"read-only document never saved or recovered");
      }finally{await f.context.close();}
    }
  }finally{
    await browser.close();if(data.real)assert.equal(hash(await readFile(process.env.DESIGN_FIDELITY_REAL_FIXTURE)),data.inputHash,"private source bytes unchanged");
    const allRecords=[...report.records,...report.isolationRecords];
    const descendantRows=selectUniqueMeasurements(allRecords).map(row=>({...row,value:{...row.value,gateFailures:[...(row.value.gateFailures??[])]}}));
    for(const record of allRecords)for(const entry of record.nodes??[])for(const [route,value]of Object.entries(entry.measurements)){
      if(!value.rawCompositePixel)continue;
      const nodes=data.design.pages.find(page=>page.id===record.page)?.nodes??data.design.nodes,node=nodes.find(candidate=>candidate.id===entry.id);
      const classification=attributeFrameComposite({value,node,nodes,rows:descendantRows,page:record.page,matrix:record.matrix,route,tile:record.tile,scale:record.scale});
      if(!classification)continue;
      value.frameCompositeAttribution=classification;
      if(classification.kind==="DESCENDANT_ATTRIBUTED"&&!value.pixelRegion&&value.primaryAvailable&&value.geometryFailures.length===0){
        value.preDescendantAttribution={failures:[...value.failures],gateFailures:[...value.gateFailures],geometryFailures:[...value.geometryFailures]};
        value.diagnosticFailures=[...new Set([...value.diagnosticFailures,...value.failures])];
        value.failures=[];value.gateFailures=[];value.geometryFailures=[];
        value.gating="descendant-attributed";
      }
      if(classification.kind==="FRAME_COMPOSITE_UNATTRIBUTED"){
        const reason="frame composite contains mismatches outside failed descendant bounds + 2 device px";
        value.failures=[...value.failures,reason];if(value.gating==="diagnostic")value.diagnosticFailures=[...value.diagnosticFailures,reason];else value.gateFailures=[...new Set([...value.gateFailures,reason])];
      }
    }
    report.rawUniqueRecords=selectUniqueMeasurements(report.records);report.uniqueRecords=selectUniqueMeasurements([...report.records,...report.isolationRecords]);
    report.countDefinitions={unit:"one (page,node,route,matrix), including the HTML reference self-comparison",truefail:"all unique rows with gateFailures; raw own-fill unavailable failures retained",effectiveTruefail:"gate failures after excluding only exact OWN_FILL_UNOBSERVABLE; excluded rows never pass",effectiveDenominator:"unique minus ownFillUnobservable; no unavailable row is converted to pass",unclassifiedFail:"unique rows with gateFailures lacking sufficient html-pixel-snap classification; no raw failure is removed",htmlPixelSnap:"historical geometry attribution only; never an accepted pass",svgPreciseSnap:"GPU/HTML pass and every SVG displacement explained within .1 device px by precise-minus-snapped box prediction; diagnostic, never raw pass",full:"complete chosen ROI, including isolation-full and explicitly derived isolation-full-composite",isolation:"chosen measurement came from the same four-route isolation transform; oversize nodes use raw same-scale tiles and a coverage-proven derived composite with copy-only provenance",unavailable:"raw primaryAvailable is false; inspect unavailableReasonCodes",effectiveUnavailable:"unavailable excluding ownFillUnobservable only",aaQualified:"geometry-pass shapes which fail raw pixels but pass explicit [1,2,1]/4 device AA refinement; never raw pass",rawPixelFail:"shape gate pixel metric fails; frame strokes use contour ring while rawCompositePixel retains full ROI",raw:"unmodified tile PNGs and per-tile metrics in records; rawUniqueRecords chooses full tiles without applying isolation"};
    report.rawSummary=fidelityCounts(report.rawUniqueRecords);report.rawSummary.tileMeasurements=report.records.reduce((sum,record)=>sum+(record.nodes??[]).reduce((total,node)=>total+Object.keys(node.measurements).length,0),0);
    const routeFailures=[...report.records,...report.isolationRecords].flatMap(record=>record.routeErrors.map(error=>({matrix:record.matrix,page:record.page,tileIndex:record.tileIndex,...error})));
    report.failures.push(...routeFailures,...report.uniqueRecords.filter(row=>!row.value.observability?.excludedFromEffectiveDenominator&&row.value.gateFailures.length).map(row=>({matrix:row.matrix,page:row.page,id:row.id,route:row.route,coverage:row.coverage,failures:row.value.gateFailures})));
    report.partialNodes=report.uniqueRecords.filter(row=>!row.complete).map(row=>({matrix:row.matrix,page:row.page,id:row.id,route:row.route,reasonCode:row.reasonCode,coverage:row.coverage}));
    const counts=fidelityCounts(report.uniqueRecords);
    report.summary={...counts,comparisons:report.records.length,isolationCaptures:report.isolationRecords.length,isolationRawTileCaptures:report.isolationTileRecords.length,compositeIsolations:report.isolationRecords.filter(record=>record.composite).length,failingChecks:report.failures.length,diagnosticFailures:counts.diagnosticFailures,diagnosticComparisons:counts.diagnostic,unavailablePrimary:counts.effectiveUnavailable,unmeasured:report.unmeasured.length,partialNodes:report.partialNodes.length,fontOmissions:report.fontOmissions.length,allMeasuredThresholdsPassed:report.failures.length===0&&counts.diagnostic===0&&counts.effectiveUnavailable===0&&report.unmeasured.length===0&&counts.partial===0&&report.fontOmissions.length===0,diagnosticModeDoesNotMeanPass:diagnostic};
    report.byMatrix=Object.fromEntries(matrix.map(item=>[item.id,fidelityCounts(report.uniqueRecords.filter(row=>row.matrix===item.id))]));
    report.byRoute=Object.fromEntries(["gpu","browser","svg","html"].map(route=>[route,fidelityCounts(report.uniqueRecords.filter(row=>row.route===route))]));
    if(isolationOnly)report.requestCoverage={expected:targetIds.size*matrix.length*captureRoutes.length,actual:report.uniqueRecords.length,missing:[...targetIds].flatMap(id=>matrix.flatMap(item=>captureRoutes.filter(route=>!report.uniqueRecords.some(row=>row.id===id&&row.matrix===item.id&&row.route===route)).map(route=>({id,matrix:item.id,route}))))};
    await writeFidelityReport(join(output,"report.json"),report);t.diagnostic(`EVIDENCE ${join(output,"report.json")} ${JSON.stringify(report.summary)}`);
  }
  if(isolationOnly){assert.equal(report.requestCoverage.actual,report.requestCoverage.expected,"isolation capture must preserve the explicit denominator");assert.deepEqual(report.requestCoverage.missing,[],"every requested node/route/matrix requires a row");}
  if(!diagnostic){assert.equal(report.failures.length,0,`Fidelity candidate has ${report.failures.length} unique threshold/route failures; see ${join(output,"report.json")}`);assert.equal(report.unmeasured.length,0,"all requested text/stroke nodes require measurements");assert.equal(report.partialNodes.length,0,"partial tile geometry cannot establish complete-node parity");assert.equal(report.summary.unavailablePrimary,0,"unavailable primary metrics cannot establish parity");assert.equal(report.summary.diagnosticComparisons,0,"unresolved diagnostic comparisons cannot establish full parity");assert.equal(report.fontOmissions.length,0,"fallback diagnostics cannot certify an unavailable requested font");}
});
