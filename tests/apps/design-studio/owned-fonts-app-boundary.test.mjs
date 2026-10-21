import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import { createOwnedFontManager } from "../../../apps/design-studio/app/owned-fonts.mjs";

const app=await readFile(new URL("../../../apps/design-studio/app/app.js",import.meta.url),"utf8");
const start=app.indexOf("async function loadReferencedDesignResources()"),end=app.indexOf("async function ensureDesignPageLoaded(",start);
assert(start>=0&&end>start);
const source=app.slice(start,end);
const resource=id=>({descriptor:{id,kind:"font",sha256:id,bytes:1,mime:"font/woff2",family:"Same",weight:400,style:"normal"},dataUrl:`data:font/woff2;base64,${id}`});
for(const mutation of ["reference-order","descriptor","cache","scope"]) test(`actual app resource loader refuses ${mutation} mutation during an awaited resource without publishing fonts or URLs`,async()=>{
  let release,entered;
  const gate=new Promise(resolve=>release=resolve),entry=new Promise(resolve=>entered=resolve);
  const foreign={},fontSet=new Set([foreign]),created=[];
  const ownedFonts=createOwnedFontManager({fontSet,createFace(...args){const face={args,async load(){return this;}};created.push(face);return face;}});
  let ids=["a","b"],scope=1;
  const state={ownedFonts,fontResourcesReady:true,resourceDataUrls:new Map([["retained","old-url"]]),design:{resources:[resource("a").descriptor,resource("b").descriptor]},referencedDesignResourceIds:()=>new Set(ids),captureDocumentScope(){const expected=scope;return()=>{if(scope!==expected)throw Error("scope changed");};}};
  state.currentResourceCache={async load(id){if(id==="a"){entered();await gate;}return resource(id);}};
  const context=createContext(state);runInContext(source,context);
  const operation=context.loadReferencedDesignResources();await entry;
  if(mutation==="reference-order")ids.reverse();
  if(mutation==="descriptor")state.design.resources[0].sha256="changed";
  if(mutation==="cache")state.currentResourceCache={};
  if(mutation==="scope")scope++;
  release();await assert.rejects(operation,/变化|scope changed/u);
  assert.deepEqual([...fontSet],[foreign]);assert.deepEqual([...state.resourceDataUrls],[["retained","old-url"]]);assert.equal(state.fontResourcesReady,false);
});
