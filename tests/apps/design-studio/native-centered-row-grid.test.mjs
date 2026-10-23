import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { importFigmaJson, prepareFigmaImport, createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { normalizeDesignDocument, serializeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { createFigmaBinding, createFigmaPatch } from "../../../apps/design-studio/app/figma-binding.mjs";
import { nativeGridPlan } from "../../../apps/design-studio/app/grid.mjs";
import { applyAutoLayouts, applyAllAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
const folder = new URL("../../fixtures/design-studio-native-centered-row-grid/", import.meta.url);
const bytes = await readFile(new URL("native-source.json", folder));
const fixture = JSON.parse(bytes), stages = JSON.parse(await readFile(new URL("native-stages.json", folder)));
const provenance = JSON.parse(await readFile(new URL("provenance.json", folder)));
const clone = structuredClone, flat = node => [node, ...(node.children ?? []).flatMap(flat)];
const id = native => `figma-${native.replace(":", "-")}`;
const nested = value => JSON.parse(serializeDesignDocument(value)).pages.flatMap(p => p.children.flatMap(flat));
const rawRowName = "half-edge-transparent-positive preserved-row0";

test("actual F456 centered/excluded Grid source keeps full cells, fractional insets, exact text units and no-op binding", async () => {
  assert.equal(createHash("sha256").update(bytes).digest("hex"), provenance.sourceSha256);
  const original = JSON.stringify(fixture), imported = await prepareFigmaImport(fixture), value = imported.document;
  assert.deepEqual(imported.warnings, []); assert.equal(value.nodes.length, 67);
  assert.equal(value.nodes.filter(n => n.layout === "grid").length, 9); assert.equal(value.nodes.filter(n => n.type === "text").length, 27);
  const tree = nested(value);
  for (const c of stages[0].cases) {
    const owner = tree.find(n => n.id === id(c.parentId));
    assert.equal(owner.paddingBottom, c.name.includes("last-rule-absent") ? 0 : .5);
    for (const native of c.rowGridIds) {
      const row = tree.find(n => n.id === id(native));
      assert.equal(row.layout, "grid"); assert.equal(row.layoutSizingHorizontal, "fill"); assert.equal(row.layoutSizingVertical, "hug");
      assert.equal(row.strokeAlign ?? "center", "center"); assert.equal(row.strokeLayoutExcluded, undefined);
      assert.deepEqual([row.paddingTop,row.paddingRight,row.paddingBottom,row.paddingLeft], [0,0,0,0]);
      assert.doesNotThrow(() => nativeGridPlan(row, owner));
      assert.throws(() => nativeGridPlan(row), /内在尺寸循环/u);
    }
    for (const [native, expected] of Object.entries(c.boxes)) {
      const node = value.nodes.find(n => n.id === id(native)); assert.deepEqual([node.x,node.y,node.width,node.height], expected);
    }
    for (const native of c.textIds) { const text = tree.find(n => n.id === id(native)); assert.equal(text.lineHeightUnit,"pixels"); assert.equal(text.lineHeight,25); }
  }
  assert.deepEqual(createFigmaTransfer(value).warnings, []);
  const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(value)));
  assert.deepEqual(createFigmaPatch(createFigmaBinding(imported),reopened).operations, []);
  assert.equal(JSON.stringify(fixture),original);
});

test("source copy and outer width edits reproduce all captured native row/cell/Text boxes without stale heights", () => {
  const value = importFigmaJson(fixture).document;
  // Deterministic advance only: explicit short source lines never wrap here.
  // Actual native boxes are the independent oracle, not this fake font's ink.
  const measurement = { configure() {}, fontAvailable: () => true, measure: text => ({width:text.length*8,bottom:19,ink:{x:0,y:0,width:text.length*8,height:19}}) };
  for (const stage of stages) for (const c of stage.cases) {
    const owner = value.nodes.find(n => n.id === id(c.parentId)), text = value.nodes.find(n => n.id === id(c.growTextId));
    owner.width = c.boxes[c.parentId][2]; text.textSource = c.characters;
    for (const native of [...c.rowGridIds,...c.cellIds]) value.nodes.find(n => n.id === id(native)).height=170;
    applyAutoLayouts(value.nodes,[owner.id,text.id],{textMeasurer:measurement});
    for (const [native,expected] of Object.entries(c.boxes)) {
      const node = value.nodes.find(n => n.id === id(native)); assert.deepEqual([node.x,node.y,node.width,node.height],expected,`${stage.name}/${node.name}`);
    }
    const reopened = normalizeDesignDocument(JSON.parse(serializeDesignDocument(value)));
    applyAllAutoLayouts(reopened.nodes,{textMeasurer:measurement});
    for (const [native,expected] of Object.entries(c.boxes)) { const node=reopened.nodes.find(n=>n.id===id(native)); assert.deepEqual([node.x,node.y,node.width,node.height],expected,`${stage.name}/reopen/${node.name}`); }
  }
});

test("only excluded bottom1 with zero row padding admits the new native intrinsic dependency", () => {
  const imported = importFigmaJson(fixture).document, tree=nested(imported), row=tree.find(n=>n.name===rawRowName), owner=tree.find(n=>n.children?.some(c=>c.id===row.id));
  for (const mutate of [r=>{r.paddingBottom=.5;},r=>{r.paddingLeft=1;},r=>{r.strokeAlign="outside";},r=>{r.strokeSides[2].width=2;},r=>{r.strokeSides[0].width=1;},r=>{delete r.strokeSides[0];},r=>{r.children[0].strokeWidth=1;},r=>{r.children[0].children.push(clone(r.children[0].children[0]));},r=>{delete r.children[0].children[0].textSource;},r=>{r.children[0].children[0].textOverflow="ellipsis";}]) {
    const changed=clone(row);mutate(changed);assert.throws(()=>nativeGridPlan(changed,owner),/内在尺寸循环|HUG/u);
  }
  const rectangleRow=clone(row);
  for(const cell of rectangleRow.children){
    cell.paddingTop=cell.paddingBottom=0;
    cell.children[0]={id:cell.children[0].id,type:"rectangle",height:25,layoutSizingVertical:"fixed",layoutSizingHorizontal:"fill"};
  }
  assert.throws(()=>nativeGridPlan(rectangleRow,owner),/内在尺寸循环|HUG/u);
  // Existing stroke-free rectangle support remains independent of the new rule.
  rectangleRow.strokeWidth=0;
  for(const side of rectangleRow.strokeSides)side.width=0;
  assert.doesNotThrow(()=>nativeGridPlan(rectangleRow,owner));
  for(const flag of [false,undefined,true,null,"false"]){
    const source=clone(fixture),target=flat(source.document).find(n=>n.name===rawRowName);
    if(flag===undefined)delete target.strokesIncludedInLayout;else target.strokesIncludedInLayout=flag;
    const r=importFigmaJson(source),out=r.document.nodes.find(n=>n.name===rawRowName);
    if(flag===false||flag===undefined){assert.equal(out.layout,"grid");assert.deepEqual(r.warnings,[]);}
    else{assert.equal(out.layout,"none");assert(r.warnings.some(w=>w.code==="unsupported-stroke-layout"));}
  }
});

test("transparent half-edge controls stay exact in CPU CSS/SVG; opaque paint and non-inside frontend export stay explicit boundaries", async t => {
  const { chromium }=await import("playwright"),{PNG}=await import("pngjs"),{resolve,sep}=await import("node:path");
  const browser=await chromium.launch({args:["--disable-gpu"]});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:760,height:1100},deviceScaleFactor:1}),root=resolve("apps/design-studio/app"),font=await readFile(resolve(root,"fonts/InterVariable.woff2"));
  const fontCss=`@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font.toString("base64")}) format('woff2');font-weight:100 900;font-style:normal;font-display:block}`;
  const blocked=[],errors=[];await context.route("**/*",async route=>{const u=new URL(route.request().url());if(u.href==="https://centered-grid.test/")return route.fulfill({contentType:"text/html",body:`<!doctype html><style>${fontCss}</style>`});if(u.origin==="https://centered-grid.test"&&u.pathname==="/fonts/InterVariable.woff2")return route.fulfill({contentType:"font/woff2",body:font});const p=resolve(root,`.${u.pathname}`);if(u.origin==="https://centered-grid.test"&&p.startsWith(root+sep)&&p.endsWith(".mjs"))return route.fulfill({contentType:"text/javascript",body:await readFile(p)});blocked.push(u.href);return route.abort();});
  const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));await page.goto("https://centered-grid.test/");
  const records=await page.evaluate(async({fixture,stages,fontCss})=>{
    const {prepareFigmaImport}=await import("/figma-bridge.mjs"),{createFigmaBinding,createFigmaPatch}=await import("/figma-binding.mjs");
    const {serializeDesignDocument,normalizeDesignDocument,exportDesignSvg}=await import("/document.mjs"),{measureFigmaTextDocument,createBrowserTextMeasurer}=await import("/text-metrics.mjs"),{applyAutoLayouts,applyAllAutoLayouts}=await import("/layout.mjs"),{exportDesignFrontend}=await import("/frontend-export.mjs");
    if(!(await document.fonts.load("400 19px Inter","V1.1 K1")).length)throw Error("Control font missing");
    const imported=await prepareFigmaImport(fixture),value=imported.document,sourceNodes=new Map();const collect=n=>{sourceNodes.set(n.id,n);n.children?.forEach(collect)};collect(fixture.document);
    await measureFigmaTextDocument(value,{nativeLineBoxes:true,sourceNodes,sourceIds:new Map(imported.mapping.map(m=>[m.designId,m.sourceId]))});
    if(createFigmaPatch(createFigmaBinding(imported),value).operations.length)throw Error("Native font measurement must remain a binding no-op");
    const measurement=createBrowserTextMeasurer(),records=[],id=s=>`figma-${s.replace(":","-")}`,escape=s=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;");
    try{for(const stage of stages){const changed=[];for(const c of stage.cases){const owner=value.nodes.find(n=>n.id===id(c.parentId)),text=value.nodes.find(n=>n.id===id(c.growTextId));owner.width=c.boxes[c.parentId][2];text.textSource=c.characters;changed.push(owner.id,text.id);}applyAutoLayouts(value.nodes,changed,{textMeasurer:measurement});
      const saved=serializeDesignDocument(value),reopened=normalizeDesignDocument(JSON.parse(saved));applyAllAutoLayouts(reopened.nodes,{textMeasurer:measurement});
      const boxes=value.nodes.map(n=>[n.id,n.x,n.y,n.width,n.height]),again=reopened.nodes.map(n=>[n.id,n.x,n.y,n.width,n.height]);if(JSON.stringify(boxes)!==JSON.stringify(again))throw Error("Reopen geometry changed");
      const tables=stage.cases.map((c,index)=>`<dl class="table t${index}" style="left:40px;top:${40+index*340}px;width:${c.boxes[c.parentId][2]}px">${[0,1,2].map(row=>`<div class="row ${index===2&&row===2?'no-rule':''}">${[0,1,2].map(col=>`<${col===0?'dt':'dd'} class="cell c${col}">${escape(col===0?'K'+(row+1):col===2?'A'+(row+1):row===0?c.characters:Array.from({length:row+1},(_,i)=>`V${row+1}.${i+1}`).join('\n'))}</${col===0?'dt':'dd'}>`).join('')}</div>`).join('')}</dl>`).join('');
      const reference=`<!doctype html><style>${fontCss}html,body{margin:0;width:760px;height:1100px;background:white}.table{position:absolute;display:table;table-layout:fixed;border-collapse:collapse;margin:0;font:400 19px/25px Inter;color:#334155}.row{display:table-row;border-bottom:1px solid #cecece}.row.no-rule{border-bottom:0}.cell{display:table-cell;box-sizing:content-box;vertical-align:top;padding:10px 20px 10px 0;margin:0;white-space:pre-wrap}.c0{width:30%}.c1{width:auto}.c2{width:20%;padding-right:0}.t1 .c0{background:#fecaca}.t1 .c1{background:#bbf7d0}.t1 .c2{background:#bfdbfe}</style>${tables}`;
      let frontendUnsupported;try{exportDesignFrontend(JSON.parse(saved));}catch(error){frontendUnsupported=error.message;}if(!frontendUnsupported)throw Error("Existing non-inside CSS paint boundary must stay explicit");records.push({name:stage.name,reference,svg:exportDesignSvg(value),frontendUnsupported,positiveBoxes:[0,2].map(i=>{const c=stage.cases[i],n=value.nodes.find(n=>n.id===id(c.parentId));return{x:n.x,y:n.y,width:n.width,height:n.height}})});
    }}finally{measurement.close();}return records;
  },{fixture,stages,fontCss});
  const bands=JSON.parse(await readFile(new URL("native-rule-bands.json",folder)));
  const rgba=(p,x,y)=>Array.from(p.data.subarray((y*p.width+x)*4,(y*p.width+x)*4+4));
  const compareRegion=(a,b,box,label)=>{assert(Number.isInteger(box.x)&&Number.isInteger(box.y)&&Number.isInteger(box.width)&&Number.isInteger(box.height));for(let y=box.y;y<box.y+box.height;y++){const i=(y*a.width+box.x)*4,j=i+box.width*4;assert(a.data.subarray(i,j).equals(b.data.subarray(i,j)),`${label}/strict row${y}`);}};
  for(const record of records){await page.setContent(record.reference);await page.evaluate(()=>document.fonts.ready);const reference=PNG.sync.read(await page.screenshot());
    assert.match(record.frontendUnsupported,/非内侧/u);for(const [mode,html]of [["SVG",`<!doctype html><style>${fontCss}html,body{margin:0;background:white}svg{display:block}</style>${record.svg}`]]){
      await page.setContent(html);await page.evaluate(()=>document.fonts.ready);const pixels=PNG.sync.read(await page.screenshot());for(const box of record.positiveBoxes)compareRegion(pixels,reference,box,`${record.name}/${mode}`);
      for(const c of bands.filter(b=>b.stage===record.name)){for(const row of c.rows){const y=row.expectedCssFullColorRow;if(y===null)continue;let gray=0;const width=row.expectedCssRulePixels;for(let x=40;x<40+width;x++)if(JSON.stringify(rgba(pixels,x,y))==='[206,206,206,255]')gray++;
        if(c.case.includes("opaque"))assert(gray<width,`${record.name}/${mode}/opaque stays CSS paint-negative`);else{assert.equal(gray,width,`${record.name}/${mode}/native rule band`);for(const p of row.bands.find(b=>b.y===y).perColumnRGBA)assert.deepEqual(rgba(pixels,p.x,y),p.rgba);}
      }}
    }
  }
  assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);
});

test("production existing-Grid stroke patch projection preserves false and rejects included CENTER before writing", async () => {
  const vm=await import("node:vm"),{hasDesignStroke,nativeDesignStroke}=await import("../../../apps/design-studio/app/stroke.mjs");
  const code=await readFile(new URL("../../../apps/design-studio/app/figma-plugin/code.js",import.meta.url),"utf8"),start=code.indexOf("  const strokeSideNames = "),end=code.indexOf("  const lineBoxY = ",start);
  assert(start>0&&end>start);const context=vm.createContext({finite:Number.isFinite,CodeShellFigmaPaint:{hasDesignStroke,nativeDesignStroke}});
  vm.runInContext(code.slice(start,end)+"\nglobalThis.plan=nativeStrokeLayoutPlan;globalThis.apply=applyNativeStrokeLayout;",context);
  const imported=await prepareFigmaImport(fixture),binding=createFigmaBinding(imported),row=imported.document.nodes.find(n=>n.name===rawRowName);
  row.strokeSides[2].color="#123456";const patch=createFigmaPatch(binding,imported.document),operation=patch.operations.find(o=>o.after?.id===row.id);
  assert.deepEqual(operation.changed,["strokeSides"]);assert.equal(patch.operations.length,1);
  let included=false;const writes=[],native={layoutMode:"GRID",strokeAlign:"CENTER",strokes:[{}],strokeTopWeight:0,strokeRightWeight:0,strokeBottomWeight:1,strokeLeftWeight:0};
  Object.defineProperty(native,"strokesIncludedInLayout",{get:()=>included,set:value=>{assert.equal(native.layoutMode,"GRID");writes.push(["included",value]);included=value;}});
  for(const side of["Top","Right","Bottom","Left"]){let value=0;Object.defineProperty(native,"padding"+side,{get:()=>value,set:next=>{writes.push([side,next]);value=next;}});}
  const planned=context.plan(native,operation.after);assert.equal(planned.included,false);assert.deepEqual(writes,[]);
  context.apply(native,planned);assert.equal(included,false);assert(writes.every(([,value])=>value===false||value===0));
  included=true;writes.length=0;assert.throws(()=>context.plan(native,operation.after),/INSIDE/u);assert.deepEqual(writes,[]);assert.equal(included,true);
});
