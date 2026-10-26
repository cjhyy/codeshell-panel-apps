import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { launchCanvasBrowser, canvasMime, observeLocalTools, metadata } from "./fixtures/canvas-test-observations.mjs";
const app=resolve(fileURLToPath(new URL("../../../apps/design-studio/app/",import.meta.url)));
async function fixture(t,{host=false}={}) {
  const browser=await launchCanvasBrowser();t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1500,height:1000}});page.setDefaultTimeout(15000);const errors=[];page.on("pageerror",e=>errors.push(e.message));page.on("dialog",d=>d.accept());
  await page.route("**/*",async route=>{const u=new URL(route.request().url()),p=resolve(app,"."+u.pathname);if(u.origin!=="https://store-ui.test"||!p.startsWith(app+sep))return route.abort();try{await route.fulfill({body:await readFile(p===resolve(app,"app.js")&&process.env.BROWSER_STORE_APP_SNAPSHOT?resolve(process.env.BROWSER_STORE_APP_SNAPSHOT):p),contentType:canvasMime[extname(p)]});}catch{await route.fulfill({status:404,body:"missing"});}});
  await observeLocalTools(page);
  if(host)await page.addInitScript(()=>{window.hostWrites=[];window.idbReads=0;Object.defineProperty(window,"indexedDB",{get(){window.idbReads++;throw Error("Host must never open browser storage");}});Object.assign(window.codeshellPanel,{getContext:async()=>({trusted:true,busy:false,cwd:"/host/project"}),call:async(method,params)=>{
    if(method==="workspace.info")return{name:"Host project",root:"/host/project",trusted:true};if(method==="workspace.list")return{entries:[],truncated:false};if(method==="storage.get")return null;if(method==="storage.set"||method==="storage.delete")return true;if(method==="workspace.readText")throw Object.assign(Error("file not found"),{code:"ENOENT"});if(method==="workspace.writeText"){window.hostWrites.push(params);throw Error("Host write intentionally denied");}throw Error("Unexpected Host method "+method);
  }});});
  await page.goto("https://store-ui.test/index.html");await page.waitForFunction(()=>!document.querySelector(".workspace").inert);
  async function importRaw(raw) {if(await page.locator("#compact-actions").getAttribute("open")===null)await page.locator("#compact-actions summary").click();await page.locator("#open-figma-workflow").click();await page.locator("#figma-import-file").setInputFiles({name:"design.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(raw))});await page.waitForFunction(()=>document.querySelector("#figma-workflow-dialog").getAttribute("aria-busy")==="false");await page.locator("#figma-import-mode").selectOption("replace");await page.locator("#figma-import-apply").click();await page.waitForFunction(()=>document.querySelector("#figma-workflow-status").textContent.includes("已导入"));await page.locator("#figma-workflow-close").click();}
  async function save(){if(await page.locator("#compact-actions").getAttribute("open")===null)await page.locator("#compact-actions summary").click();await page.locator("#save").click();await page.waitForFunction(()=>["已保存","保存失败","保存状态待核对"].includes(document.querySelector("#save-state").textContent));return page.locator("#save-state").textContent();}
  async function backup(){if(await page.locator("#compact-actions").getAttribute("open")===null)await page.locator("#compact-actions summary").click();await page.locator("#portable-backup-open").click();const pending=page.waitForEvent("download");await page.locator("#portable-backup-export").click();const text=await readFile(await(await pending).path(),"utf8");await page.keyboard.press("Escape");return JSON.parse(text);}
  return{page,errors,importRaw,save,backup};
}
async function multiFontInput(){
  const definitions=[["Roboto","Regular",400,"normal","Roboto-Variable.ttf"],["Roboto","Italic",400,"italic","Roboto-Italic-Variable.ttf"],["Inter","Regular",400,"normal","InterVariable.woff2"],["Inter","Italic",400,"italic","InterVariable-Italic.woff2"],["Font Awesome 6 Free","Black",900,"normal","fa-solid-900.woff2"],["Font Awesome 6 Free","Regular",400,"normal","fa-regular-400.woff2"],["Font Awesome 6 Brands","Regular",400,"normal","fa-brands-400.woff2"]];
  const fontAssets={},children=[];for(const[i,[family,style,weight,fontStyle,file]]of definitions.entries()){
    fontAssets["original-font-"+i]={family,weight,style:fontStyle,mime:file.endsWith("ttf")?"font/ttf":"font/woff2",base64:(await readFile(resolve(app,"fonts",file))).toString("base64")};
    children.push({id:"text-"+i,type:"TEXT",name:"Text "+i,x:20,y:20+50*i,width:500,height:40,characters:i<4?"Original editable large-font design":i===6?"\uf099":"\uf004",fontName:{family,style},fontWeight:weight,fontSize:24,lineHeight:{unit:"PIXELS",value:32},fills:[{type:"SOLID",color:{r:0,g:0,b:0}}]});
  }return{nodes:[{id:"root",type:"FRAME",name:"Large original multi-font document",x:0,y:0,width:600,height:420,children}],fontAssets};
}

test("browser IndexedDB saves a real multi-font design above localStorage capacity and reopens complete source/resources",async t=>{
  const f=await fixture(t),raw=await multiFontInput();await f.page.evaluate(()=>localStorage.setItem("unrelated-user-value","preserve"));assert.equal(await f.save(),"已保存");await f.importRaw(raw);
  const before=await f.backup();assert(Buffer.byteLength(JSON.stringify(before))>5*1024*1024,"real fonts+source must actually exceed the old total budget");
  assert.equal(await f.save(),"已保存");const saved=await f.backup();await f.page.reload();await f.page.waitForFunction(()=>!document.querySelector(".workspace").inert);const reopened=await f.backup();
  for(const field of["document","resources","attachments"])assert.deepEqual(reopened[field],saved[field],field+" must remain complete on real private-origin reopen");
  assert.equal((await metadata(f.page)).layers.length,8);assert.equal(await f.page.evaluate(()=>localStorage.getItem("unrelated-user-value")),"preserve");assert.match(await f.page.locator("#repo-link-state").getAttribute("title"),/未写入 CodeShell/u);assert.deepEqual(f.errors,[]);
});

test("Host errors propagate and never access the browser database",async t=>{
  const f=await fixture(t,{host:true});assert.equal(await f.save(),"保存失败");assert.match(await f.page.locator("#toast").textContent(),/Host write intentionally denied/u);const value=await f.page.evaluate(()=>({writes:hostWrites.length,idbReads}));assert.equal(value.writes,1);assert.equal(value.idbReads,0);assert.deepEqual(f.errors,[]);
});

test("original private IANA wrapper saves and reopens all nodes/font bytes/source attachments",{skip:!process.env.IANA_FONT_ASSETS_DIR},async t=>{
  const f=await fixture(t),path=resolve(process.env.IANA_FONT_ASSETS_DIR,"..","frozen.colors.studio.json"),raw=JSON.parse(await readFile(path,"utf8"));
  await f.importRaw(raw);assert.equal(await f.save(),"已保存");const saved=await f.backup();await f.page.reload();await f.page.waitForFunction(()=>!document.querySelector(".workspace").inert);const reopened=await f.backup();
  assert.equal((await metadata(f.page)).layers.length,151);for(const field of["document","resources","attachments"])assert.deepEqual(reopened[field],saved[field]);
  const binding=JSON.parse(reopened.attachments.find(a=>a.kind==="figma-binding").content);assert(Object.values(binding.source.nodes).some(n=>isDeepStrictEqual(n.document.codeshellHtml2FigmaFontAssets,raw.fontAssets)));
  if(process.env.BROWSER_STORAGE_EVIDENCE_DIR){await mkdir(process.env.BROWSER_STORAGE_EVIDENCE_DIR,{recursive:true});await writeFile(resolve(process.env.BROWSER_STORAGE_EVIDENCE_DIR,"iana-reopened.complete-backup.json"),JSON.stringify(reopened));await writeFile(resolve(process.env.BROWSER_STORAGE_EVIDENCE_DIR,"iana-save-reopen.json"),JSON.stringify({nodes:151,checks:{document:isDeepStrictEqual(saved.document,reopened.document),resources:isDeepStrictEqual(saved.resources,reopened.resources),attachments:isDeepStrictEqual(saved.attachments,reopened.attachments)},originalFontAssets:true,errors:f.errors},null,2));}
  assert.deepEqual(f.errors,[]);
});


// A legacy LS write can cross the completed IDB transaction. The persisted
// candidate is then uncertain, so import rollback must retain the same live
// candidate instead of presenting the old canvas as if publication never ran.
test("uncertain browser publication retains the imported canvas and both persisted versions",async t=>{
  const f=await fixture(t),path="designs/browser-publication.codesign.json";
  await f.page.locator("#compact-actions summary").click();
  await f.page.locator("#document-path").fill(path);
  assert.equal(await f.save(),"已保存");
  assert.equal((await metadata(f.page)).layers.length,0);
  const result=await f.page.evaluate(async path=>{
    const {createBrowserStore}=await import("/browser-store.mjs"),store=createBrowserStore();
    await store.call("workspace.writeText",{path:"designs/publication-source.html",content:'<!doctype html><style>body{margin:0}</style><main id="publication-root" style="width:200px;height:80px;background:#22c55e"></main>',expectedModifiedAt:null});
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open("codeshell-design-studio-v1",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const records=async name=>new Promise((resolve,reject)=>{const tx=db.transaction(name,"readonly"),r=tx.objectStore(name).getAll();let values;r.onsuccess=()=>values=r.result;tx.oncomplete=()=>resolve(values);tx.onabort=()=>reject(tx.error);});
    const key="file:"+path,original=(await records("records")).find(r=>r.key===key),legacy=JSON.stringify({...JSON.parse(original.content),name:"Legacy competing writer"});
    const transaction=IDBDatabase.prototype.transaction,put=IDBObjectStore.prototype.put;
    let injected=0;
    IDBDatabase.prototype.transaction=function(...args){const tx=transaction.apply(this,args);if(Array.from(tx.objectStoreNames).includes("history"))tx.addEventListener("complete",()=>{if(tx.crossedPrincipal){localStorage.setItem("codeshell-design-studio:"+key,legacy);injected++;}});return tx;};
    IDBObjectStore.prototype.put=function(value,...args){if(this.name==="records"&&value.key===key&&value.content.includes("publication-root"))this.transaction.crossedPrincipal=true;return put.call(this,value,...args);};
    let failure;
    try {
      const state=await tools.get_design_metadata({});
      await tools.import_html({path:"designs/publication-source.html",root_selector:"#publication-root",viewport_width:600,viewport_height:300,save:true,expected_state_revision:state.stateRevision});
    }catch(error){failure={code:error.code,message:error.message,unknown:error.designPublicationUnknown};}
    finally{IDBDatabase.prototype.transaction=transaction;IDBObjectStore.prototype.put=put;}
    const current=await tools.get_design_metadata({}),rows=await records("records"),history=await records("history");db.close();
    return{injected,failure,current,stored:rows.find(r=>r.key===key),oldRecord:original,legacy,retainedLegacy:localStorage.getItem("codeshell-design-studio:"+key),history:history.filter(r=>r.record.key===key),saveState:document.querySelector("#save-state").textContent,renderedLayerCount:document.querySelectorAll("#layers-list .layer-row").length};
  },path);
  if(process.env.BROWSER_STORAGE_EVIDENCE_DIR){await mkdir(process.env.BROWSER_STORAGE_EVIDENCE_DIR,{recursive:true});await writeFile(resolve(process.env.BROWSER_STORAGE_EVIDENCE_DIR,"uncertain-publication.json"),JSON.stringify(result,null,2));}
  assert.equal(result.injected,1);
  assert.equal(result.failure.code,"BROWSER_LEGACY_CONFLICT");
  assert.equal(result.failure.unknown,true);
  assert.equal(result.current.layers.length,2,"an uncertain published import must retain its viewport and source frame instead of restoring the empty canvas");
  assert.deepEqual(result.current.layers.map(node=>node.name),["HTML viewport","main#publication-root"]);
  assert.equal(result.renderedLayerCount,2,"the live layer list must reflect the retained published draft");
  assert.match(result.stored.content,/publication-root/);
  assert.equal(result.retainedLegacy,result.legacy);
  assert(result.history.some(entry=>entry.record.content===result.oldRecord.content),"the exact previous IDB principal remains in history");
  assert.equal(result.saveState,"保存状态待核对");
  assert.deepEqual(f.errors,[]);
});
