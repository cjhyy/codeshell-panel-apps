import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
const source = await readFile(new URL("../../../apps/design-studio/app/browser-store.mjs",import.meta.url),"utf8");
async function fixture(t) {
  const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage();
  await page.route("**/*",route=>route.fulfill({body:route.request().url().endsWith(".mjs")?source:"<!doctype html>",contentType:route.request().url().endsWith(".mjs")?"text/javascript":"text/html"}));
  await page.goto("https://browser-store.test/");
  await page.evaluate(async()=>{const {createBrowserStore}=await import("/browser-store.mjs");window.makeStore=createBrowserStore;window.store=createBrowserStore({now:()=>1000});});return page;
}

test("file content/time/revision commit atomically; a real transaction quota abort preserves all three",async t=>{
  const page=await fixture(t),result=await page.evaluate(async()=>{
    const path="designs/a.codesign.json",old=await store.call("workspace.writeText",{path,content:"old",expectedModifiedAt:null});
    const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(this.name==="records"&&value.content==="new")throw new DOMException("injected capacity failure","QuotaExceededError");return put.call(this,value,...args);};
    let code;try{await store.call("workspace.writeText",{path,content:"new",expectedRevision:old.revision});}catch(error){code=error.code;}finally{IDBObjectStore.prototype.put=put;}
    return{old,after:await store.call("workspace.readText",{path}),code};
  });assert.deepEqual(result.after,result.old);assert.equal(result.code,"BROWSER_STORAGE_QUOTA");
});

test("two database clients with one expected revision cannot both commit even at the same clock time",async t=>{
  const page=await fixture(t),result=await page.evaluate(async()=>{
    const path="designs/a.codesign.json",old=await store.call("workspace.writeText",{path,content:"old"}),other=makeStore({now:()=>1000});
    const results=await Promise.allSettled([store,other].map((client,index)=>client.call("workspace.writeText",{path,content:"writer "+index,expectedRevision:old.revision})));
    return{results:results.map(result=>({status:result.status,code:result.reason?.code,revision:result.value?.revision})),old,after:await store.call("workspace.readText",{path})};
  });assert.equal(result.results.filter(r=>r.status==="fulfilled").length,1);assert.equal(result.results.find(r=>r.status==="rejected").code,"BROWSER_STORAGE_CONFLICT");assert.notEqual(result.old.revision,result.after.revision);assert(result.after.modifiedAt>result.old.modifiedAt);
});

for(const mode of ["quota","abort"])test(`a ${mode} during principal publication rolls back staged source index and principal together`,async t=>{
  const page=await fixture(t),result=await page.evaluate(async mode=>{
    for(const[path,content]of[["designs/a.codesign.json","old design"],["designs/a.figma-source.json","old source index"],["designs/codesign-data/font.txt","original font bytes"]])await store.call("workspace.writeText",{path,content});
    const before=await Promise.all(["designs/a.codesign.json","designs/a.figma-source.json","designs/codesign-data/font.txt"].map(path=>store.call("workspace.readText",{path})));
    const batch=store.begin();await batch.call("workspace.writeText",{path:before[1].path,content:"new source index",expectedRevision:before[1].revision});await batch.call("workspace.writeText",{path:before[0].path,content:"new design",expectedRevision:before[0].revision});
    const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(this.name==="records"&&value.content==="new design"&&mode==="quota")throw new DOMException("injected quota","QuotaExceededError");const request=put.call(this,value,...args);if(this.name==="records"&&value.content==="new source index"&&mode==="abort")request.addEventListener("success",()=>this.transaction.abort());return request;};
    let code;try{await batch.commit();}catch(error){code=error.code;}finally{IDBObjectStore.prototype.put=put;}
    return{code,before,after:await Promise.all(before.map(({path})=>store.call("workspace.readText",{path})))};
  },mode);assert.deepEqual(result.after,result.before);assert.equal(result.code,mode==="quota"?"BROWSER_STORAGE_QUOTA":"BROWSER_STORAGE_ABORT");
});

test("legacy documents without mtime migrate by content fingerprint, retain original keys, and detect later old writes",async t=>{
  const page=await fixture(t),result=await page.evaluate(async()=>{
    const path="designs/old.codesign.json",key="codeshell-design-studio:file:"+path;localStorage.setItem(key,"legacy original");localStorage.setItem("foreign-user-key","preserve");
    const original=await store.call("workspace.readText",{path}),next=await store.call("workspace.writeText",{path,content:"new IDB copy",expectedRevision:original.revision});
    const first=await store.call("workspace.readText",{path}),legacyAfter=localStorage.getItem(key);localStorage.setItem(key,"new write from old version");
    const codes=[];for(const method of["workspace.readText","workspace.writeText"])try{await store.call(method,{path,content:"must not overwrite",expectedRevision:next.revision});}catch(error){codes.push(error.code);}
    const db=await new Promise(resolve=>{const r=indexedDB.open("codeshell-design-studio-v1");r.onsuccess=()=>resolve(r.result);});const get=storeName=>new Promise(resolve=>{const r=db.transaction(storeName).objectStore(storeName).getAll();r.onsuccess=()=>resolve(r.result);});
    const records=await get("records"),history=await get("history");db.close();
    return{original,first,legacyAfter,codes,latestLegacy:localStorage.getItem(key),foreign:localStorage.getItem("foreign-user-key"),record:records.find(r=>r.key==="file:"+path).content,history:history.map(r=>r.record.content)};
  });assert.equal(result.original.content,"legacy original");assert.match(result.original.revision,/^legacy:/);assert.equal(result.first.content,"new IDB copy");assert.equal(result.legacyAfter,"legacy original");assert.deepEqual(result.codes,["BROWSER_LEGACY_CONFLICT","BROWSER_LEGACY_CONFLICT"]);assert.equal(result.latestLegacy,"new write from old version");assert.equal(result.record,"new IDB copy");assert(result.history.includes("legacy original"));assert.equal(result.foreign,"preserve");
});

for(const mutation of["delete","mtime","created"])test(`legacy ${mutation} after IDB publication is detected rather than hidden`,async t=>{
  const page=await fixture(t),code=await page.evaluate(async mutation=>{
    const path="designs/legacy.codesign.json",key="codeshell-design-studio:file:"+path,time="codeshell-design-studio:mtime:"+path;
    if(mutation!=="created"){localStorage.setItem(key,"old");localStorage.setItem(time,"1000");}await store.call("workspace.writeText",{path,content:"IDB version"});
    if(mutation==="delete")localStorage.removeItem(key);else if(mutation==="mtime")localStorage.setItem(time,"2000");else localStorage.setItem(key,"old client creates a different file");
    try{await store.call("workspace.readText",{path});}catch(error){return error.code;}
  },mutation);assert.equal(code,"BROWSER_LEGACY_CONFLICT");
});

test("a legacy edit across commit aborts publication before mutation",async t=>{
  const page=await fixture(t),result=await page.evaluate(async()=>{
    const path="designs/legacy.codesign.json",key="codeshell-design-studio:file:"+path;localStorage.setItem(key,"original");const batch=store.begin();await batch.call("workspace.writeText",{path,content:"staged"});
    const get=IDBObjectStore.prototype.get;let changed=false;IDBObjectStore.prototype.get=function(value){const r=get.call(this,value);if(this.transaction.mode==="readwrite"&&!changed){changed=true;r.addEventListener("success",()=>localStorage.setItem(key,"concurrent old client"));}return r;};
    let code;try{await batch.commit();}catch(error){code=error.code;}finally{IDBObjectStore.prototype.get=get;}
    return{code,content:(await store.call("workspace.readText",{path})).content};
  });assert.equal(result.code,"BROWSER_LEGACY_CONFLICT");assert.equal(result.content,"concurrent old client");
});

test("legacy edit at transaction completion reports uncertainty and retains both committed IDB and legacy copies",async t=>{
  const page=await fixture(t),result=await page.evaluate(async()=>{
    const path="designs/legacy.codesign.json",key="codeshell-design-studio:file:"+path;localStorage.setItem(key,"original");const batch=store.begin();await batch.call("workspace.writeText",{path,content:"IDB intended"});
    const transaction=IDBDatabase.prototype.transaction;let changed=false;IDBDatabase.prototype.transaction=function(stores,mode,...args){const tx=transaction.call(this,stores,mode,...args);if(mode==="readwrite"&&!changed){changed=true;tx.addEventListener("complete",()=>localStorage.setItem(key,"late old writer"));}return tx;};
    let code,uncertain;try{await batch.commit();}catch(error){code=error.code;uncertain=error.designPublicationUnknown;}finally{IDBDatabase.prototype.transaction=transaction;}
    let readCode;try{await store.call("workspace.readText",{path});}catch(error){readCode=error.code;}
    const db=await new Promise(resolve=>{const r=indexedDB.open("codeshell-design-studio-v1");r.onsuccess=()=>resolve(r.result);});const all=name=>new Promise(resolve=>{const r=db.transaction(name).objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);});const records=await all("records"),history=await all("history");db.close();
    return{code,uncertain,readCode,legacy:localStorage.getItem(key),idb:records.find(r=>r.key==="file:"+path).content,history:history.map(r=>r.record.content)};
  });assert.equal(result.code,"BROWSER_LEGACY_CONFLICT");assert(result.uncertain);assert.equal(result.readCode,"BROWSER_LEGACY_CONFLICT");assert.equal(result.legacy,"late old writer");assert.equal(result.idb,"IDB intended");assert(result.history.includes("original"));
});

test("storage snapshot/CAS is transactional across clients, with truthful conflict receipts and tombstones",async t=>{
  const page=await fixture(t),result=await page.evaluate(async()=>{
    const other=makeStore(),missing=await store.call("storage.getSnapshot",{key:"draft"});
    const results=await Promise.all([store,other].map((client,index)=>client.call("storage.compareAndSet",{key:"draft",expectedRevision:missing.revision,value:{writer:index}})));
    const current=await store.call("storage.getSnapshot",{key:"draft"});const removed=await store.call("storage.compareAndSet",{key:"draft",expectedRevision:current.revision,remove:true});return{missing,results,current,removed};
  });assert.equal(result.results.filter(r=>r.updated).length,1);assert.equal(result.results.filter(r=>!r.updated).length,1);assert.match(result.current.revision,/^sha256:[0-9a-f]{64}$/);assert.deepEqual(result.removed,{updated:true,snapshot:{exists:false,value:null,revision:null}});
});


test("a scope change at transaction completion reports committed publication instead of a rollback-safe refusal",async t=>{
  const page=await fixture(t),result=await page.evaluate(async()=>{
    const path="designs/scope.codesign.json",old=await store.call("workspace.writeText",{path,content:"old"});
    let stale=false;const batch=store.begin({check:()=>{if(stale)throw Object.assign(Error("scope changed after commit"),{code:"SCOPE_CHANGED"});}});
    await batch.call("workspace.writeText",{path,content:"committed candidate",expectedRevision:old.revision});
    const transaction=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(stores,mode,...args){const tx=transaction.call(this,stores,mode,...args);if(mode==="readwrite")tx.addEventListener("complete",()=>stale=true);return tx;};
    let failure;try{await batch.commit();}catch(error){failure={code:error.code,unknown:error.designPublicationUnknown};}finally{IDBDatabase.prototype.transaction=transaction;}
    return{failure,content:(await store.call("workspace.readText",{path})).content};
  });
  assert.equal(result.content,"committed candidate");assert.equal(result.failure.code,"SCOPE_CHANGED");assert.equal(result.failure.unknown,true,"the successful IDB commit cannot be treated as rollback-safe after a later scope guard");
});
