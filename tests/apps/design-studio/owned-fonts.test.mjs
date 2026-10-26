import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createOwnedFontManager, designFontResourceRoles } from "../../../apps/design-studio/app/owned-fonts.mjs";

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const resource = (id="a", sha="1", family="Fixture") => ({descriptor:{id,kind:"font",sha256:sha,bytes:4,mime:"font/woff2",family,weight:400,style:"normal"},dataUrl:`data:font/woff2;base64,${sha}`});
function fixture() {
  const foreign = {family:"Fixture",foreign:true}, fontSet = new Set([foreign]), created = [], pending = new Map();
  let addFailure = null, deleteFailure = null;
  const add = fontSet.add.bind(fontSet), remove = fontSet.delete.bind(fontSet);
  fontSet.add = face => { add(face); if (addFailure === face) { addFailure=null; throw Error("add failure after insertion"); } return fontSet; };
  fontSet.delete = face => { if (deleteFailure === face) { deleteFailure=null; throw Error("delete failure"); } return remove(face); };
  const manager = createOwnedFontManager({fontSet,createFace(family,source,descriptors) {
    const gate = pending.get(source), face={family,source,descriptors,async load(){ if (gate) await gate.promise; return this; }};
    created.push(face); return face;
  }});
  const prepare = async (resources, check, options) => { const token=manager.begin(check), value=await manager.prepare(token,resources,options); return () => manager.commit(token,value); };
  const set = async (resources, options) => (await prepare(resources,undefined,options))();
  return {manager,fontSet,foreign,created,pending,prepare,set,failAdd:face=>addFailure=face,failDelete:face=>deleteFailure=face};
}

test("decoded candidates are inactive until the complete set commits; empty commits release only exact owned instances", async () => {
  const f=fixture(), commit=await f.prepare([resource()]);
  assert.deepEqual([...f.fontSet],[f.foreign]); commit(); const a=f.created[0];
  assert(f.fontSet.has(a)); await f.set([]); assert.deepEqual([...f.fontSet],[f.foreign]);
  await f.set([resource()]); assert.notEqual(f.created.at(-1),a); assert(f.fontSet.has(f.foreign));
});

test("same document resource reuse keeps identity; same ID changed bytes/family/weight/style creates the actual new face", async () => {
  const f=fixture(); await f.set([resource()]); const initial=f.created[0];
  await f.set([structuredClone(resource())]); assert.equal(f.created.length,1); assert(f.fontSet.has(initial));
  for(const change of [r=>{r.dataUrl+="changed";},r=>{r.descriptor.sha256="2";},r=>{r.descriptor.family="Other";},r=>{r.descriptor.weight=700;},r=>{r.descriptor.style="italic";}]) {
    const next=resource(); change(next); const old=[...f.fontSet].find(face=>face!==f.foreign);
    await f.set([next]); assert(!f.fontSet.has(old)); assert(f.fontSet.has(f.created.at(-1))); assert(f.fontSet.has(f.foreign));
  }
});

test("font roles preserve only-glyph fallback declarations while primary, unpinned and range families use verified variable axes", () => {
  const fonts = [resource("primary","1","Glyph, Primary"),resource("fallback","2","Local Fallback"),resource("range","3","Range Primary")].map(value=>value.descriptor);
  const node = {type:"text",fontRef:"primary",fontFamily:'"Glyph, Primary", "Local Fallback", sans-serif'};
  assert.deepEqual([...designFontResourceRoles([node],fonts)],[['primary','selected'],['fallback','glyph-fallback']]);
  const unpinned = {...node,fontRef:undefined,fontFamily:'"Local Fallback", sans-serif'};
  assert.equal(designFontResourceRoles([node,unpinned],fonts).get("fallback"),"selected");
  assert.equal(designFontResourceRoles([unpinned,node],fonts).get("fallback"),"selected","primary use wins regardless of node order");
  const ranged = {...node,textRanges:{ranges:[{fontFamily:'"Range Primary", "Local Fallback"'}]}};
  assert.deepEqual([...designFontResourceRoles([ranged],fonts)],[['primary','selected'],['fallback','glyph-fallback'],['range','selected']]);
  assert.deepEqual([...designFontResourceRoles([{...node,fontFamily:'"Local Fallback", sans-serif'}],fonts)],[['primary','selected']],"a pinned different-family resource overrides the canonical chain");
  assert.equal(designFontResourceRoles([{type:"text",fontFamily:'sans-serif, "Local Fallback"'}],fonts).get("fallback"),"glyph-fallback");
  assert.equal(designFontResourceRoles([{...node,type:"rectangle"}],fonts).size,0);
});

test("only-glyph fallback role changes rebuild exact faces and lease rollback restores the earlier variable range", async () => {
  const f=fixture(), bytes=await readFile(new URL("../../../apps/design-studio/app/fonts/InterVariable.woff2",import.meta.url));
  const value={...resource(),bytes,dataUrl:`data:font/woff2;base64,${bytes.toString("base64")}`}, before=structuredClone(value.descriptor);
  await f.set([value]); const primary=f.created.at(-1),lease=f.manager.captureLease();
  assert.equal(primary.descriptors.weight,"100 900","default callers retain byte-proven primary support");
  const fallback={roles:new Map([[value.descriptor.id,"glyph-fallback"]])};
  await f.set([value],fallback); const secondary=f.created.at(-1);
  assert.notEqual(secondary,primary); assert.equal(secondary.descriptors.weight,"400"); assert(!f.fontSet.has(primary));
  await f.set([structuredClone(value)],fallback); assert.equal(f.created.at(-1),secondary,"same-role resource reuse remains stable");
  await f.set([value],{roles:new Map([[value.descriptor.id,"selected"]])}); const selected=f.created.at(-1);
  assert.notEqual(selected,secondary); assert.equal(selected.descriptors.weight,"100 900"); assert(!f.fontSet.has(secondary));
  assert(f.manager.restoreLease(lease)); assert(f.fontSet.has(primary)); assert(!f.fontSet.has(selected));
  assert.deepEqual(value.descriptor,before); assert(f.fontSet.has(f.foreign));
});

test("one rejected decoder never publishes another decoded face and preserves the complete old set", async () => {
  const f=fixture(); await f.set([resource()]); const old=f.created[0], gate=deferred();
  f.pending.set(`url(${resource("bad","bad").dataUrl})`,gate);
  const token=f.manager.begin(), prepared=f.manager.prepare(token,[resource("new","2"),resource("bad","bad")]);
  await Promise.resolve(); assert.deepEqual([...f.fontSet],[f.foreign,old]); gate.reject(Error("invalid actual bytes"));
  await assert.rejects(prepared,/invalid actual bytes/); assert.deepEqual([...f.fontSet],[f.foreign,old]);
});

test("lease rollback restores the precise earlier set after successful publication, including clear/create rollback", async () => {
  const f=fixture(); await f.set([resource()]); const old=f.created[0], lease=f.manager.captureLease();
  await f.set([resource("b","2")]); const b=f.created[1]; assert(!f.fontSet.has(old));
  assert.equal(f.manager.restoreLease(lease),true); assert(f.fontSet.has(old)); assert(!f.fontSet.has(b));
  f.manager.clear(); assert.deepEqual([...f.fontSet],[f.foreign]); assert.equal(f.manager.restoreLease(lease),true); assert(f.fontSet.has(old));
  assert.equal(f.manager.restoreLease({}),false);
});

for(const boundary of ["reset","suspend"]) test(`${boundary} invalidates pending decodes and old rollback leases without touching foreign faces`,async()=>{
  const f=fixture(); await f.set([resource()]); const lease=f.manager.captureLease(), gate=deferred();
  f.pending.set(`url(${resource("late","2").dataUrl})`,gate);
  const token=f.manager.begin(), pending=f.manager.prepare(token,[resource("late","2")]);
  f.manager[boundary](); gate.resolve(); await assert.rejects(pending,/作用域/u);
  assert.equal(f.manager.restoreLease(lease),false); assert.deepEqual([...f.fontSet],[f.foreign]);
  if(boundary==="suspend") { assert.throws(()=>f.manager.begin(),/作用域/u); f.manager.clear(); assert.throws(()=>f.manager.begin(),/作用域/u); assert.equal(f.manager.resume(),true); assert.equal(f.manager.resume(),false); }
  await f.set([resource()]); assert(f.fontSet.has(f.foreign));
});

test("a newer operation supersedes an older decode and an already prepared commit",async()=>{
  const f=fixture(), oldCommit=await f.prepare([resource()]), gate=deferred();
  f.pending.set(`url(${resource("late","2").dataUrl})`,gate);
  const token=f.manager.begin(), pending=f.manager.prepare(token,[resource("late","2")]);
  await f.set([resource("current","3")]); assert.throws(oldCommit,/作用域/u); gate.resolve(); await assert.rejects(pending,/作用域/u);
  assert.deepEqual([...f.fontSet],[f.foreign,f.created.find(face=>face.source.includes("base64,3"))]);
});

test("scope is checked after every awaited decoder and before commit; stale scope never adds a face",async()=>{
  const f=fixture(); let current=true; const token=f.manager.begin(()=>{ if(!current)throw Error("document switched"); });
  const prepared=await f.manager.prepare(token,[resource()]); current=false;
  assert.throws(()=>f.manager.commit(token,prepared),/document switched/); assert.deepEqual([...f.fontSet],[f.foreign]);
});

test("page hydration reconciles all still referenced fonts, preserving independent same-family faces",async()=>{
  const f=fixture(); await f.set([resource("p1"),resource("p2","2")]); const [a,b]=f.created;
  await f.set([resource("p1"),resource("p2","2")]); assert.equal(f.created.length,2);
  await f.set([resource("p2","2")]); assert(!f.fontSet.has(a)); assert(f.fontSet.has(b)); assert(f.fontSet.has(f.foreign));
});

test("retained same-family faces follow the requested order, including a failed reordered insertion rollback",async()=>{
  const f=fixture(); await f.set([resource("a"),resource("b","2")]); const [a,b]=f.created,lease=f.manager.captureLease();
  await f.set([resource("b","2"),resource("a")]); assert.equal(f.created.length,2);
  assert.deepEqual([...f.fontSet],[f.foreign,b,a]);
  f.manager.restoreLease(lease); assert.deepEqual([...f.fontSet],[f.foreign,a,b]);
  const commit=await f.prepare([resource("b","2"),resource("a")]); f.failAdd(a);
  assert.throws(commit,/add failure/); assert.deepEqual([...f.fontSet],[f.foreign,a,b]);
});

test("a native FontFaceSet insertion failure rolls back its partial insertion and retains the previous lease",async()=>{
  const f=fixture(); await f.set([resource()]); const old=f.created[0], commit=await f.prepare([resource("b","2")]);
  f.failAdd(f.created[1]); assert.throws(commit,/add failure/); assert.deepEqual([...f.fontSet],[f.foreign,old]);
});

test("a native removal failure is reported and rollback reestablishes the prior exact set",async()=>{
  const f=fixture(); await f.set([resource()]); const old=f.created[0], commit=await f.prepare([resource("b","2")]);
  f.failDelete(old); assert.throws(commit,/delete failure/); assert.deepEqual([...f.fontSet],[f.foreign,old]);
});

test("reset/suspend/repeated release are idempotent; independently added faces sharing the owned family survive",async()=>{
  const f=fixture(); await f.set([resource()]); const laterForeign={family:"Fixture"}; f.fontSet.add(laterForeign);
  f.manager.reset(); f.manager.reset(); f.manager.suspend(); f.manager.suspend(); f.manager.clear();
  assert.deepEqual([...f.fontSet],[f.foreign,laterForeign]);
});
