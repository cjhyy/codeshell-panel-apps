import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, sep, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createDesignResourcePersistencePlan } from "../../../apps/design-studio/app/resource-store.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";

const app=resolve(fileURLToPath(new URL("../../../apps/design-studio/app/",import.meta.url))),origin="https://browser-ui.test",path="designs/browser.codesign.json";
const evidence=process.env.CODESHELL_BROWSER_UI_EVIDENCE_DIR;
const hash=value=>"sha256:"+createHash("sha256").update(JSON.stringify(value)).digest("hex");
const copy="Before the application deadline please view your application and keep the confirmation.";
const shape=(id,type,x,y,width,height,extra={})=>({id,name:id,type,x,y,width,height,fill:"#1768a5",stroke:"transparent",strokeWidth:0,opacity:1,rotation:0,cornerRadius:0,visible:true,locked:false,...(["frame","component","group"].includes(type)?{layout:"none",padding:0,gap:0,alignItems:"start",justifyContent:"start"}:{}),...extra});
function designFixture(){return normalizeDesignDocument({format:"codeshell.design",version:3,name:"Browser UI fixture",canvas:{width:800,height:500,background:"#ffffff"},tokens:{colors:[]},resources:[],activePageId:"page",pages:[{id:"page",name:"Page",children:[shape("card","frame",20,20,600,9999,{fill:"#eeeeee",layout:"vertical",padding:20,gap:12,layoutSizingVertical:"hug",children:[shape("text","text",9000,9000,9999,9999,{fill:"#111111",text:copy,textSource:copy,fontFamily:"Arial, sans-serif",fontSize:20,fontWeight:400,fontStyle:"normal",letterSpacing:0,lineHeight:1.5,textDecoration:"none",textAlign:"left",textFlow:"wrap",layoutSizingHorizontal:"fill",layoutSizingVertical:"hug"}),shape("box","rectangle",1234,1234,80,40)]}),shape("manual","rectangle",650,80,80,50,{fill:"#e45522"})]}]});}
async function fixture(t,{design=designFixture(),parts=[]}={}){
 const browser=await chromium.launch({args:["--disable-gpu"]});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1500,height:960},deviceScaleFactor:1}),files=new Map([[path,serializeDesignDocument(design)],...parts.map(part=>[part.path,part.content])]),records=new Map(),calls=[],errors=[],requests=[];
 page.on("pageerror",error=>errors.push(error.message));
 await page.route("**/*",async route=>{const url=new URL(route.request().url()),file=resolve(app,"."+url.pathname);requests.push(url.pathname);assert.equal(url.origin,origin);assert(file.startsWith(app+sep));try{return route.fulfill({body:await readFile(file),contentType:{".html":"text/html",".mjs":"text/javascript",".js":"text/javascript",".css":"text/css",".woff2":"font/woff2",".ttf":"font/ttf"}[extname(file)],headers:{"Content-Security-Policy":"default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';connect-src 'self';img-src 'self' data: blob:;font-src 'self' data: blob:;object-src 'none';base-uri 'none'"}});}catch{return route.fulfill({status:404,body:"missing"});}});
 await page.exposeFunction("hostBridge",async(method,params={})=>{
  calls.push({method,...structuredClone(params)});
  const snapshot=()=>({exists:records.has(params.key),value:records.get(params.key)??null,revision:records.has(params.key)?hash(records.get(params.key)):null});
  if(method==="workspace.info")return{root:"/browser-fixture",cwd:"/browser-fixture",name:"Fixture"};
  if(method==="workspace.list")return{entries:[],truncated:false};
  if(method==="workspace.readText"){if(!files.has(params.path))throw Error("file not found: "+params.path);const content=files.get(params.path);return{content,modifiedAt:1,revision:hash(content)};}
  if(method==="workspace.writeText"){files.set(params.path,params.content);return{modifiedAt:1,revision:hash(params.content)};}
  if(method==="storage.get")return params.key.startsWith("lastPath.")?{workspaceRoot:"/browser-fixture",path}:records.get(params.key)??null;
  if(method==="storage.set"){records.set(params.key,structuredClone(params.value));return null;}
  if(method==="storage.delete"){records.delete(params.key);return null;}
  if(method==="storage.getSnapshot")return snapshot();
  if(method==="storage.compareAndSet"){if(params.expectedRevision!==snapshot().revision)return{updated:false,snapshot:snapshot()};if(params.remove)records.delete(params.key);else records.set(params.key,structuredClone(params.value));return{updated:true,snapshot:snapshot()};}
  throw Error("Unsupported "+method);
 });
 await page.addInitScript(()=>{
  window.tools={};window.browserContexts=[];const getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){window.browserContexts.push(kind);return getContext.call(this,kind,...args);};
  window.codeshellPanel={getContext:async()=>({trusted:true,busy:false,cwd:"/browser-fixture",sessionId:"browser-fixture",capabilities:{packageAssets:{wasm:false,fetch:"package"}},availableMethods:["workspace.info","workspace.list","workspace.readText","workspace.writeText","storage.get","storage.set","storage.delete","storage.getSnapshot","storage.compareAndSet"]}),on(){},registerTool(name,callback){window.tools[name]=callback;},call:(method,params)=>window.hostBridge(method,params)};
 });
 await page.goto(origin+"/index.html");
 await page.waitForFunction(async()=>!document.querySelector(".workspace").inert&&window.tools.get_design_metadata&&(await tools.get_design_metadata({})).name==="Browser UI fixture");
 t.after(()=>{assert.deepEqual(errors,[]);assert(!requests.some(path=>path.includes("/canvas/vendor/")||path.endsWith(".wasm")),"CPU browser task must not request CanvasKit");});
 return{page,files,records,calls,errors,requests,design};
}
const active=page=>page.waitForFunction(()=>document.querySelector("#stage-wrap").dataset.browserActive==="true");
async function point(page,x,y){return page.locator("#stage").evaluate((canvas,p)=>{const transform=canvas.getContext("2d").getTransform(),rect=canvas.getBoundingClientRect(),target=transform.transformPoint(new DOMPoint(p.x,p.y));return{x:rect.x+target.x*rect.width/canvas.width,y:rect.y+target.y*rect.height/canvas.height};},{x,y});}

test("actual app chooses Browser explicitly, uses DOM selection/editor geometry and persists the choice across save/reopen",async t=>{
 const f=await fixture(t),{page}=f;
 assert.equal(await page.locator("#renderer-mode").inputValue(),"gpu");assert.equal(await page.locator("#stage-wrap").getAttribute("data-browser-active"),"false");
 await page.locator("#renderer-mode").selectOption("browser");await active(page);
 assert.equal(await page.locator("#renderer-state").textContent(),"浏览器 HTML/CSS");assert.equal(await page.locator("#gpu-canvas").isHidden(),true);
 const before=await page.evaluate(()=>tools.get_design_context({node_id:"text"}));
 const p=await point(page,50,50);await page.mouse.click(p.x,p.y);
 assert.deepEqual((await page.evaluate(()=>tools.get_design_metadata({}))).selection,["text"]);
 assert.equal(await page.locator("#selection-size").textContent(),"560 × 60");
 await page.mouse.dblclick(p.x,p.y);const editor=page.locator("#inline-text-editor");await editor.waitFor({state:"visible"});
 const editorBox=await editor.boundingBox(),topLeft=await point(page,40,40),bottomRight=await point(page,600,100);
 assert(Math.abs(editorBox.x-topLeft.x)<.01);assert(Math.abs(editorBox.y-topLeft.y)<.01);assert(Math.abs(editorBox.width-(bottomRight.x-topLeft.x))<.01);
 const edited=copy+" "+copy;await editor.fill(edited);await editor.press("Control+Enter");
 await page.waitForFunction(async text=>(await tools.get_design_context({node_id:"text"})).node.textSource===text,edited);await active(page);
 const after=await page.evaluate(()=>tools.get_design_context({node_id:"text"}));assert.equal(after.node.layoutSizingHorizontal,"fill");assert.equal(after.node.layoutSizingVertical,"hug");assert.equal(after.node.layoutPositioning,undefined);assert.equal(before.node.id,after.node.id);
 await page.evaluate(async()=>tools.save_design({expected_state_revision:(await tools.get_design_metadata({})).stateRevision}));
 const preference=[...f.records].filter(([key])=>key.startsWith("rendererMode."));assert.equal(preference.length,1);assert.equal(preference[0][1],"browser");
 await page.reload();await active(page);assert.equal(await page.locator("#renderer-mode").inputValue(),"browser");assert.equal((await page.evaluate(()=>tools.get_design_context({node_id:"text"}))).node.textSource,edited);
 assert(!await page.evaluate(()=>browserContexts.some(kind=>/webgl|bitmaprenderer/iu.test(kind))));
 if(evidence){await mkdir(evidence,{recursive:true});await page.screenshot({path:join(evidence,"browser-editor-save-reopen.png")});await writeFile(join(evidence,"receipt.json"),JSON.stringify({kind:"CPU_ACTUAL_BROWSER_EDITOR",launchArgs:["--disable-gpu"],before,after,preference,calls:f.calls.map(call=>({method:call.method,key:call.key,path:call.path})),requests:f.requests},null,2)+"\n");}
});

test("actual app drags, reorders and resizes from DOM boxes under pan/zoom without making AL children absolute",async t=>{
 const {page}=await fixture(t);await page.locator("#renderer-mode").selectOption("browser");await active(page);
 await page.locator("#zoom-out").click();await page.locator("#zoom-out").click();await page.locator("#zoom-in").click();
 const panStart=await point(page,200,250);await page.mouse.move(panStart.x,panStart.y);await page.mouse.down({button:"middle"});await page.mouse.move(panStart.x+61,panStart.y+33);await page.mouse.up({button:"middle"});
 const drag=async(from,to)=>{const a=await point(page,...from),b=await point(page,...to);await page.keyboard.down("Alt");await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.mouse.up();await page.keyboard.up("Alt");await active(page);};
 await drag([690,105],[730,135]);
 const manual=(await page.evaluate(()=>tools.get_design_context({node_id:"manual"}))).node;
 assert.deepEqual([manual.x,manual.y,manual.width,manual.height],[690,110,80,50]);
 await drag([80,132],[80,30]);
 const reordered=await page.evaluate(()=>tools.get_design_context({node_id:"card"}));
 assert.deepEqual(reordered.node.children.map(child=>child.id),["box","text"]);
 assert.equal(reordered.node.layout,"vertical");assert.equal(reordered.node.layoutSizingVertical,"hug");
 const select=await point(page,100,105);await page.mouse.click(select.x,select.y);await page.waitForFunction(()=>document.querySelector("#selection-size").textContent==="560 × 60");
 const before=(await page.evaluate(()=>tools.get_design_context({node_id:"text"}))).node;
 const handle=await point(page,600,152),cancelEnd=await point(page,630,172);
 await page.mouse.move(handle.x,handle.y);await page.mouse.down();await page.mouse.move(cancelEnd.x,cancelEnd.y);await page.keyboard.press("Escape");await page.mouse.up();await active(page);
 const cancelled=(await page.evaluate(()=>tools.get_design_context({node_id:"text"}))).node;
 for(const key of ["x","y","width","height","layoutSizingHorizontal","layoutSizingVertical"])assert.equal(cancelled[key],before[key],"cancel restores authored/derived source field "+key);
 await drag([600,152],[640,182]);
 const resized=(await page.evaluate(()=>tools.get_design_context({node_id:"text"}))).node;
 const resizeDiagnostic=await page.evaluate(()=>({size:document.querySelector("#selection-size").textContent,renderer:document.querySelector("#stage-wrap").dataset,editorHidden:document.querySelector("#inline-text-editor").hidden}));
 if(evidence){await mkdir(evidence,{recursive:true});await page.screenshot({path:join(evidence,"resize-before-assert.png")});await writeFile(join(evidence,"resize-before-assert.json"),JSON.stringify({manual,reordered,before,cancelled,resized,resizeDiagnostic},null,2)+"\n");}
 await page.waitForFunction(()=>document.querySelector("#selection-size").textContent==="600 × 90",{},{timeout:2000});
 assert.deepEqual([resized.width,resized.height],[600,90]);assert.equal(resized.layoutSizingHorizontal,"fixed");assert.equal(resized.layoutSizingVertical,"fixed");assert.equal(resized.layoutPositioning,undefined);assert.equal((await page.evaluate(()=>tools.get_design_metadata({}))).layers.find(node=>node.id==="text").parentId,"card");
 await page.evaluate(async()=>tools.save_design({expected_state_revision:(await tools.get_design_metadata({})).stateRevision}));await page.reload();await active(page);
 const reopened=await page.evaluate(()=>tools.get_design_context({node_id:"card"}));assert.deepEqual(reopened.node.children.map(child=>child.id),["box","text"]);assert(reopened.node.children.every(child=>child.layoutPositioning!=="absolute"));
 if(evidence){await mkdir(evidence,{recursive:true});await page.screenshot({path:join(evidence,"browser-drag-reorder-resize.png")});await writeFile(join(evidence,"interactions.json"),JSON.stringify({cpuOnly:true,launchArgs:["--disable-gpu"],manual,reordered,before,cancelled,resized,reopened},null,2)+"\n");}
});

test("actual browser editor keeps supplied missing-glyph fallback families and nearest weight matching",async t=>{
 const design=designFixture(),parts=[];
 for(const [id,family,fontFile,weight]of [["primary","Glyph, Primary","fa-solid-900.woff2",900],["fallback","Local Fallback","InterVariable.woff2",400]]){
  const bytes=await readFile(join(app,"fonts",fontFile));const plan=await createDesignResourcePersistencePlan({id,kind:"font",mime:"font/woff2",base64:bytes.toString("base64"),family,weight,style:"normal",sha256Bytes:async bytes=>createHash("sha256").update(bytes).digest("hex")});design.resources.push(plan.descriptor);parts.push(...plan.parts);
 }
 const text=design.nodes.find(node=>node.id==="text");text.fontRef="primary";text.fontFamily='"Glyph, Primary", "Local Fallback", Arial, sans-serif';text.fontWeight=900;text.text=text.textSource="MMMM éèàçùñïôö iii 0123456789";
 const {page}=await fixture(t,{design,parts});await page.locator("#renderer-mode").selectOption("browser");await active(page);
 const p=await point(page,60,55);await page.mouse.dblclick(p.x,p.y);const editor=page.locator("#inline-text-editor");await editor.waitFor({state:"visible"});
 await page.waitForFunction(()=>document.querySelector("#inline-text-editor").style.fontFamily.includes("family-1"));
 const proof=await editor.evaluate(element=>{const style=getComputedStyle(element),canvas=document.createElement("canvas"),context=canvas.getContext("2d"),value=element.value;context.font=`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;const actual=context.measureText(value).width;context.font=`${style.fontStyle} ${style.fontWeight} ${style.fontSize} "Glyph, Primary", "Local Fallback", Arial, sans-serif`;const reference=context.measureText(value).width;context.font=`${style.fontStyle} ${style.fontWeight} ${style.fontSize} "Glyph, Primary"`;return{runtime:style.fontFamily,actual,reference,onlyFirst:context.measureText(value).width,value,loaded:document.fonts.check('400 20px "Local Fallback"',"éèàçùñïôö")};});
 assert.match(proof.runtime,/resource-/u);assert.match(proof.runtime,/family-1/u);assert.equal(proof.actual,proof.reference);assert.notEqual(proof.actual,proof.onlyFirst);assert(proof.loaded);
 await editor.fill(proof.value+" ééé");await editor.press("Control+Enter");await active(page);
 const after=(await page.evaluate(()=>tools.get_design_context({node_id:"text"}))).node;assert.equal(after.fontFamily,text.fontFamily);assert.equal(after.fontRef,"primary");assert.equal(after.layoutSizingHorizontal,"fill");assert.equal(after.layoutSizingVertical,"hug");assert.equal(after.layoutPositioning,undefined);
 if(evidence){await mkdir(evidence,{recursive:true});await page.screenshot({path:join(evidence,"browser-font-editor.png")});await writeFile(join(evidence,"font-editor.json"),JSON.stringify({cpuOnly:true,proof,after,resourcePins:design.resources},null,2)+"\n");}
});

test("reverse-flow pointer dragging keeps ordinary AL intact when this bounded reorder operation is unavailable",async t=>{
 const design=designFixture();design.nodes.find(node=>node.id==="card").layoutReverse=true;
 const {page}=await fixture(t,{design});await page.locator("#renderer-mode").selectOption("browser");await active(page);
 const before=await page.evaluate(()=>tools.get_design_context({node_id:"card"}));
 const from=await point(page,80,60),to=await point(page,80,100);await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:5});await page.mouse.up();await active(page);
 const after=await page.evaluate(()=>tools.get_design_context({node_id:"card"}));assert.deepEqual(after.node,before.node);assert.deepEqual(after.node.children.map(node=>node.id),["text","box"]);assert(after.node.children.every(node=>node.layoutPositioning!=="absolute"));
 if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,"reverse-reorder-unavailable.json"),JSON.stringify({cpuOnly:true,before,after},null,2)+"\n");}
});

test("Browser explains unsupported instance sizing, retains the model and recovers only after an explicit Fixed edit",async t=>{
 const design=normalizeDesignDocument({format:"codeshell.design",version:3,name:"Browser UI fixture",canvas:{width:800,height:500,background:"#ffffff"},tokens:{colors:[]},resources:[],activePageId:"page",pages:[{id:"page",name:"Page",children:[shape("card","frame",20,20,600,70,{fill:"#eeeeee",layout:"vertical",padding:20,gap:0,layoutSizingVertical:"hug",children:[shape("instance","instance",9000,9000,9999,30,{fill:"transparent",componentId:"master",layoutSizingHorizontal:"fill",layoutSizingVertical:"fixed"})]})]},{id:"library",name:"Library",children:[shape("master","component",0,0,100,30,{fill:"transparent",children:[shape("blue","rectangle",0,0,100,30,{fill:"#0000ff"})]})]}]});
 const {page}=await fixture(t,{design}),before=(await page.evaluate(()=>tools.get_design_context({node_id:"instance"}))).node;
 await page.locator("#renderer-mode").selectOption("browser");await page.waitForFunction(()=>document.querySelector("#stage-wrap").dataset.rendererStatus==="error");
 assert.equal(await page.locator("#renderer-mode").inputValue(),"browser");assert.equal(await page.locator("#renderer-state").textContent(),"实例尺寸不支持");const message=await page.locator("#renderer-message-text").textContent();assert.match(message,/Hug\/Fill/u);assert.match(message,/设计数据已保留/u);assert.equal(await page.locator("#gpu-canvas").isHidden(),true);
 const refused=(await page.evaluate(()=>tools.get_design_context({node_id:"instance"}))).node;assert.deepEqual(refused,before);
 if(evidence){await mkdir(evidence,{recursive:true});await page.screenshot({path:join(evidence,"browser-instance-capability-refusal.png")});}
 await page.evaluate(async()=>tools.use_design({expected_state_revision:(await tools.get_design_metadata({})).stateRevision,operations:[{op:"update_node",node_id:"instance",changes:{layoutSizingHorizontal:"fixed",width:560}}]}));await active(page);
 const recovered=(await page.evaluate(()=>tools.get_design_context({node_id:"instance"}))).node;assert.equal(recovered.id,before.id);assert.equal(recovered.width,560);assert.equal(recovered.layoutSizingHorizontal,"fixed");assert.equal(recovered.layoutPositioning,undefined);assert.equal(await page.locator("#renderer-mode").inputValue(),"browser");
 if(evidence){await page.screenshot({path:join(evidence,"browser-instance-fixed-recovery.png")});await writeFile(join(evidence,"instance-capability.json"),JSON.stringify({cpuOnly:true,before,refused,recovered,message},null,2)+"\n");}
});
