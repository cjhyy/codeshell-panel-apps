import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { plainFixture } from "./fixtures/figma-plugin-v3.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { textRangeSourceSignature } from "../../../apps/design-studio/app/text-ranges.mjs";

const digest = value=>`sha256:${createHash("sha256").update(typeof value==="string"?value:JSON.stringify(value)).digest("hex")}`;

test("CPU public edit_text/update_node are atomic and preserve ranges through rollback, inspector, save and reopen",async(t)=>{
  const browser=await chromium.launch({args:["--disable-gpu"]});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:1500,height:960}}),page=await context.newPage();page.setDefaultTimeout(5000);
  const app=resolve("apps/design-studio/app"),manifest=JSON.parse(await readFile(resolve(app,"../.codeshell-panel/panel.json"))),path="designs/ranges.codesign.json";
  const doc=plainFixture(),frame=doc.pages[0].children[0],text=frame.children[0],source="Alpha link beta.\n\nBlank space \u00a0";
  Object.assign(frame,{layout:"vertical",width:320,height:220,padding:16,alignItems:"start"});
  Object.assign(text,{text:source,textSource:source,textFlow:"wrap",fontSize:20,lineHeight:1.25,layoutSizingHorizontal:"fill",layoutSizingVertical:"hug",textRanges:{version:1,sourceSignature:textRangeSourceSignature(source),ranges:[{start:6,end:10,fill:"#1a65a6",href:"#"}]}});
  const hug={...text,id:"hug-rich",text:"AB",width:20,height:25,minWidth:12,layoutSizingHorizontal:"hug",textRanges:{version:1,sourceSignature:textRangeSourceSignature("AB"),ranges:[{start:0,end:2,fill:"#ff0000"}]}};
  delete hug.textSource;delete hug.textFlow;frame.children.push(hug);
  const plainHug={...hug,id:"hug-plain"};delete plainHug.textRanges;frame.children.push(plainHug);
  const files=new Map([[path,serializeDesignDocument(normalizeDesignDocument(doc))]]),records=new Map(),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await context.route("**/*",async route=>{
    const url=new URL(route.request().url()),file=resolve(app,"."+url.pathname);
    if(url.origin!=="https://ranges-tools.test"||!file.startsWith(app+sep))return route.abort();
    try{return route.fulfill({body:await readFile(file),contentType:({".mjs":"text/javascript",".js":"text/javascript",".css":"text/css",".html":"text/html",".wasm":"application/wasm",".woff2":"font/woff2"})[extname(file)]??"application/octet-stream"});}catch{return route.fulfill({status:404,body:"missing"});}
  });
  await page.exposeFunction("rangeHost",async(method,p={})=>{
    const snapshot=()=>records.has(p.key)?{exists:true,value:records.get(p.key),revision:digest(records.get(p.key))}:{exists:false,value:null,revision:null};
    if(method==="workspace.info")return{root:"/fixture",trusted:true,name:"Ranges"};
    if(method==="workspace.list")return{entries:[],truncated:false};
    if(method==="workspace.readText"){if(!files.has(p.path))throw Error("ENOENT: no such file or directory, open '"+p.path+"'");return{path:p.path,content:files.get(p.path),modifiedAt:1,revision:digest(files.get(p.path))};}
    if(method==="workspace.writeText"){const previous=files.get(p.path);if(p.expectedRevision!==undefined&&p.expectedRevision!==(previous===undefined?null:digest(previous)))throw Error("revision conflict");files.set(p.path,p.content);return{path:p.path,modifiedAt:1,revision:digest(p.content)};}
    if(method==="storage.get")return p.key.startsWith("lastPath.")?{workspaceRoot:"/fixture",path}:records.get(p.key)??null;
    if(method==="storage.set"){records.set(p.key,p.value);return true;}
    if(method==="storage.delete"){records.delete(p.key);return true;}
    if(method==="storage.getSnapshot")return snapshot();
    if(method==="storage.compareAndSet"){if(p.expectedRevision!==snapshot().revision)return{updated:false,snapshot:snapshot()};if(p.remove)records.delete(p.key);else records.set(p.key,p.value);return{updated:true,snapshot:snapshot()};}
    throw Error("Unexpected host method "+method);
  });
  await page.addInitScript(({permissions})=>{
    const state={trusted:true,visible:true,busy:false,capabilities:{packageAssets:{wasm:true}},...(permissions.includes("context.workspace")?{cwd:"/fixture"}:{}),...(permissions.includes("context.session")?{sessionId:"ranges"}:{}),projectScope:{version:1,environmentId:"test",projectId:"ranges",rootId:"root"},availableMethods:["workspace.info","workspace.list","workspace.readText","workspace.writeText","storage.get","storage.set","storage.delete","storage.getSnapshot","storage.compareAndSet"]};
    window.tools={};window.codeshellPanel={getContext:async()=>state,on(){},call:(method,params)=>window.rangeHost(method,params),registerTool:(name,fn)=>window.tools[name]=fn};
  },{permissions:manifest.permissions});
  const loaded=()=>page.waitForFunction(()=>!document.querySelector(".workspace").inert&&window.tools.use_design);
  const tool=(name,args={})=>page.evaluate(({name,args})=>window.tools[name](args),{name,args});
  await page.goto("https://ranges-tools.test/index.html");await loaded();
  const initial=files.get(path),meta=await tool("get_design_metadata");
  const edited="updated\n\n \u00a0",applied=await tool("use_design",{expected_state_revision:meta.stateRevision,operations:[{op:"edit_text",node_id:text.id,start:6,end:10,text:edited,affinity:"after",expectedSourceSignature:text.textRanges.sourceSignature}]});
  let saved=normalizeDesignDocument(JSON.parse(files.get(path))).nodes.find(n=>n.id===text.id);
  assert.equal(saved.textSource,source.slice(0,6)+edited+source.slice(10));
  assert.equal(saved.textRanges.ranges[0].end,6+edited.length);
  assert.equal(saved.textRanges.ranges[0].href,"#");
  const beforeFailure=files.get(path),beforeRevision=(await tool("get_design_metadata")).stateRevision;
  await assert.rejects(tool("use_design",{expected_state_revision:beforeRevision,operations:[{op:"update_node",node_id:text.id,changes:{text:"stale full replacement"}}]}),/textRanges/);
  assert.equal(files.get(path),beforeFailure);assert.equal((await tool("get_design_metadata")).stateRevision,beforeRevision);
  await tool("rollback_design",{transaction_id:applied.transactionId,save:true});
  assert.equal(files.get(path),initial);
  await page.reload();await loaded();
  await tool("use_design",{expected_state_revision:(await tool("get_design_metadata")).stateRevision,operations:[{op:"update_node",node_id:text.id,changes:{name:"Selected rich text"}}],save:false});
  const input=page.locator('#prop-text');
  assert.equal(await input.count(),1);
  {
    await input.focus();await input.evaluate(e=>e.setSelectionRange(6,10));await page.keyboard.insertText("replacement");await input.dispatchEvent("change");assert.equal(await input.inputValue(),source.replace("link","replacement"));await tool("save_design",{action:"save",expected_state_revision:(await tool("get_design_metadata")).stateRevision});
    saved=normalizeDesignDocument(JSON.parse(files.get(path))).nodes.find(n=>n.id===text.id);
    assert.equal(saved.textSource,source.replace("link","replacement"));assert(saved.textRanges);
  }
  await page.locator("#edit-text-selection").click();
  const inline=page.locator("#inline-text-editor");
  // Opening the editor focuses/selects in its first animation frame.
  await page.waitForFunction(()=>document.activeElement?.id==="inline-text-editor");
  const selected=await inline.evaluate(e=>{
    e.setSelectionRange(6,17);
    e.addEventListener("beforeinput",()=>e.dataset.testSelection=JSON.stringify([e.selectionStart,e.selectionEnd]),{once:true});
    return {focused:document.activeElement===e,start:e.selectionStart,end:e.selectionEnd};
  });
  assert.deepEqual(selected,{focused:true,start:6,end:17});
  await page.keyboard.insertText("short");
  assert.deepEqual(JSON.parse(await inline.getAttribute("data-test-selection")),[6,17]);
  await page.keyboard.press("Control+Enter");
  await tool("save_design",{action:"save",expected_state_revision:(await tool("get_design_metadata")).stateRevision});
  saved=normalizeDesignDocument(JSON.parse(files.get(path))).nodes.find(n=>n.id===text.id);
  assert.equal(saved.textSource,source.replace("link","short"));
  assert.deepEqual(saved.textRanges.ranges,[{start:6,end:11,fill:"#1a65a6",href:"#"}]);
  const revision=(await tool("get_design_metadata")).stateRevision;
  await tool("use_design",{expected_state_revision:revision,operations:[{op:"update_node",node_id:text.id,changes:{text:"Plain\n\n \u00a0",textRanges:null}}]});
  await page.reload();await loaded();
  saved=normalizeDesignDocument(JSON.parse(files.get(path))).nodes.find(n=>n.id===text.id);
  assert.equal(saved.textSource,"Plain\n\n \u00a0");assert.equal(saved.textRanges,undefined);
  await tool("use_design",{expected_state_revision:(await tool("get_design_metadata")).stateRevision,operations:[{op:"edit_text",node_id:hug.id,start:2,end:2,text:"CDEFGHIJ",affinity:"before",expectedSourceSignature:hug.textRanges.sourceSignature}]});
  let savedHug=normalizeDesignDocument(JSON.parse(files.get(path))).nodes.find(n=>n.id===hug.id);
  assert.equal(savedHug.textSource,"ABCDEFGHIJ");assert(savedHug.width>20);const hugWidth=savedHug.width;
  await page.reload();await loaded();
  savedHug=normalizeDesignDocument(JSON.parse(files.get(path))).nodes.find(n=>n.id===hug.id);
  assert.equal(savedHug.width,hugWidth);assert.equal(savedHug.textSource,"ABCDEFGHIJ");
  await tool("use_design",{expected_state_revision:(await tool("get_design_metadata")).stateRevision,operations:[{op:"edit_text",node_id:hug.id,start:0,end:10,text:"",affinity:"none",expectedSourceSignature:savedHug.textRanges.sourceSignature}]});
  savedHug=normalizeDesignDocument(JSON.parse(files.get(path))).nodes.find(n=>n.id===hug.id);
  assert.equal(savedHug.width,12);assert.equal(savedHug.height,25);assert.equal(savedHug.textSource,"");assert.equal(savedHug.textRanges,undefined);
  await tool("use_design",{expected_state_revision:(await tool("get_design_metadata")).stateRevision,operations:[{op:"edit_text",node_id:plainHug.id,start:2,end:2,text:"CDEFGHIJ",affinity:"none",expectedSourceSignature:textRangeSourceSignature("AB")}]});
  const savedPlainHug=normalizeDesignDocument(JSON.parse(files.get(path))).nodes.find(n=>n.id===plainHug.id);
  assert.equal(savedPlainHug.textSource,"ABCDEFGHIJ");assert(savedPlainHug.width>20);assert.equal(savedPlainHug.textRanges,undefined);
  assert.deepEqual(errors,[]);
});
