import assert from "node:assert/strict";
import { test } from "node:test";
import { isolateFidelityDesign, selectUniqueMeasurements, classifyHtmlPixelSnap, fidelityCounts } from "./render-fidelity-attribution.mjs";
import { strokeEdgeScans } from "./render-fidelity.metrics.mjs";
const value = (failures = []) => ({ primaryAvailable: true, failures, gateFailures: failures, gating: "primary-and-secondary" });
const record = (tileIndex, complete, measurement = value()) => ({ page: "p", matrix: "m", tileIndex, tile: {x:tileIndex,y:0,width:100,height:100}, nodes:[{id:"n",complete,clearance:tileIndex,measurements:{gpu:measurement}}] });
test("unique attribution selects a complete tile before a larger partial and never selects by outcome", () => {
  const rows = selectUniqueMeasurements([record(0,false),record(1,true,value(["real failure"])),record(2,false)]);
  assert.equal(rows.length,1);assert.equal(rows[0].tileIndex,1);assert.equal(rows[0].coverage,"full");assert.deepEqual(rows[0].value.gateFailures,["real failure"]);
  assert.equal(selectUniqueMeasurements([record(0,true),record(1,true,value(["failure"]))])[0].tileIndex,1,"fixed clearance ranking cannot choose the passing crop");
});
test("partial and unavailable retain reason codes; isolated full replaces raw once without erasing raw", () => {
  const raw = [record(0,false,{...value(),primaryAvailable:false,unavailableReasonCodes:["INK_NOT_FOUND"]})];
  const before = JSON.stringify(raw), partial = selectUniqueMeasurements(raw)[0];
  assert.equal(partial.reasonCode,"NO_COMPLETE_TILE");assert.deepEqual(partial.value.unavailableReasonCodes,["INK_NOT_FOUND"]);
  const isolated={...record(0,true),isolation:{targetId:"n",version:1}};
  const rows=selectUniqueMeasurements([...raw,isolated]);assert.equal(rows.length,1);assert.equal(rows[0].coverage,"isolation-full");assert.equal(JSON.stringify(raw),before);
  assert.equal(selectUniqueMeasurements([record(0,true),{...record(1,false),isolation:{targetId:"n",version:1}}])[0].coverage,"full","partial isolation cannot override a complete raw tile");
  assert.equal(selectUniqueMeasurements([{...isolated,composite:{singleScreenshot:false}}])[0].coverage,"isolation-full-composite","derived full coverage must never be presented as a single screenshot");
  assert.deepEqual(fidelityCounts(rows),{unique:1,full:1,isolation:1,partial:0,unavailable:0,truefail:0,unclassifiedFail:0,htmlPixelSnap:0,diagnostic:0,diagnosticFailures:0});
});
test("isolation hides sibling and descendant paint without removing flow; ancestors retain fill, clip, opacity and transform", () => {
  const nodes=[{id:"a",type:"frame",fill:"#eeeeee",opacity:.6,rotation:13,clipContent:true,layout:"horizontal",strokeWidth:4,shadow:{blur:5},x:10,y:20}, {id:"target",parentId:"a",type:"frame",opacity:.4,layout:"vertical",x:20,y:30}, {id:"sibling",parentId:"a",opacity:.8,x:3,y:4}, {id:"child",parentId:"target",opacity:1}];
  const design={activePageId:"p",nodes,pages:[{id:"p",nodes}],canvas:{width:200,height:100}};const before=JSON.stringify(design);
  const isolated=isolateFidelityDesign(design,"target");const byId=new Map(isolated.design.nodes.map(n=>[n.id,n]));
  assert.equal(JSON.stringify(design),before);assert.deepEqual(byId.get("target"),nodes[1]);
  for(const field of ["fill","opacity","rotation","clipContent","layout","x","y"])assert.equal(byId.get("a")[field],nodes[0][field]);
  assert.equal(byId.get("a").strokeWidth,4);assert.equal(byId.get("a").stroke,"transparent");assert.equal(byId.get("a").shadow,undefined);
  for(const id of ["sibling","child"]){assert.equal(byId.get(id).opacity,0);assert.notEqual(byId.get(id).visible,false,"flow placeholders remain in native layout");}
  assert.deepEqual(isolated.metadata.ancestorIds,["a"]);assert.deepEqual(isolated.design.pages[0].nodes,isolated.design.nodes);
  assert.throws(()=>isolateFidelityDesign(design,"missing"),/Unknown isolation target/u);
});
const scans = (centroid=0,width=2) => ({measurable:true,probes:["top","right","bottom","left"].flatMap(edge=>[.25,.5,.75].map(fraction=>({edge,fraction,centroid,width})))});
test("html-pixel-snap requires fractional device edges and matching four-edge GPU/SVG evidence; never marks pass", () => {
  const measurements={gpu:{strokeEdges:scans(.8)},svg:{strokeEdges:scans(.85)},html:{strokeEdges:scans(0)}};
  const node={x:10.25,y:12,width:20,height:20,strokeWidth:2};
  const classification=classifyHtmlPixelSnap({node,scale:1,measurements});assert.equal(classification.kind,"html-pixel-snap");assert.equal(classification.pass,false);
  const classified=fidelityCounts([{complete:true,value:{...value(["stroke centroid .8 > .35"]),strokeClassification:classification}}]);
  assert.equal(classified.truefail,1);assert.equal(classified.unclassifiedFail,0);assert.equal(classified.htmlPixelSnap,1,"a classified exception must remain a failing row, never a pass");
  assert.equal(classifyHtmlPixelSnap({node:{...node,x:10},scale:1,measurements}),null);
  assert.equal(classifyHtmlPixelSnap({node,scale:1,measurements:{...measurements,svg:{strokeEdges:scans(.65)}}}),null);
  assert.equal(classifyHtmlPixelSnap({node,scale:1,measurements:{...measurements,gpu:{strokeEdges:scans(1.01)}}}),null);
  assert.equal(classifyHtmlPixelSnap({node,scale:1,measurements:{...measurements,svg:{strokeEdges:{measurable:false,probes:[]}}}}),null);
});
function rectangle(dx=0,dy=0,{inner=false}={}){const width=60,height=60,data=new Uint8Array(width*height*4).fill(255);for(let y=10+dy;y<40+dy;y++)for(let x=10+dx;x<40+dx;x++)if(x<12+dx||x>=38+dx||y<12+dy||y>=38+dy||inner&&y===16+dy){const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=0;}return{width,height,data};}
test("four-edge multiple scans reject interior same-color lines and detect injected one/two-pixel shifts", () => {
  const options={bounds:{x:11,y:11,width:28,height:28},strokeWidth:2,foreground:[0,0,0],background:[255,255,255]};
  const reference=strokeEdgeScans(rectangle(),options), contaminated=strokeEdgeScans(rectangle(0,0,{inner:true}),options);
  assert(reference.measurable);assert.equal(reference.probes.length,12);assert.deepEqual(new Set(reference.probes.map(p=>p.edge)),new Set(["top","right","bottom","left"]));
  for(const probe of contaminated.probes)assert.equal(probe.width,2,"nearby interior line must not inflate stroke width");
  for(const delta of [1,2]){const actual=strokeEdgeScans(rectangle(0,delta),options);assert(actual.measurable);for(const [index,probe] of actual.probes.entries())if(probe.edge==="top"||probe.edge==="bottom")assert.equal(probe.centroid-reference.probes[index].centroid,delta);}
});

test("inside ancestor isolation retains side widths, padding, clip and layout exclusion while suppressing only paint", () => {
  const ancestor={id:"inside",type:"frame",fill:"#ffffff",stroke:"#111111",strokeWidth:4,strokeAlign:"inside",strokeSides:[2,3,4,5].map(width=>({width,color:"#111111",opacity:.5})),strokeLayoutExcluded:true,layout:"horizontal",padding:8,clipContent:true,cornerRadius:0,opacity:.7};
  const target={id:"target",parentId:"inside",type:"text",x:12,y:18,width:100,height:24};
  const isolated=isolateFidelityDesign({nodes:[ancestor,target],pages:[],canvas:{width:200,height:100}},"target").design.nodes[0];
  for(const field of ["strokeWidth","strokeAlign","strokeLayoutExcluded","layout","padding","clipContent","cornerRadius","opacity"])assert.equal(isolated[field],ancestor[field]);
  assert.deepEqual(isolated.strokeSides.map(side=>side.width),[2,3,4,5]);assert(isolated.strokeSides.every(side=>side.opacity===0));
});

test("composite isolation stitches integer device positions once, preserves source bytes and proves complete coverage", async () => {
  const { stitchFidelityTiles }=await import("./render-fidelity-attribution.mjs");
  const sample=(width,height,value)=>({width,height,data:Uint8Array.from({length:width*height*4},(_,i)=>i%4===3?255:value)});
  const first=sample(4,4,30),second=sample(4,4,80),before=first.data.slice();
  const result=stitchFidelityTiles([{image:first,tile:{x:10,y:20,width:2,height:2},source:"tile-0.png"},{image:second,tile:{x:11,y:20,width:2,height:2},source:"tile-1.png"}],{bounds:{x:10,y:20,width:3,height:2},scale:2});
  assert.equal(result.image.width,6);assert.equal(result.image.height,4);assert.equal(result.provenance.coveredPixels,24);assert.equal(result.provenance.overlapPixels,8);assert.equal(result.provenance.overlapDifferentPixels,8);
  assert.equal(result.provenance.sources.reduce((sum,source)=>sum+source.selectedPixels,0),24,"every output pixel has one owner");
  for(let y=0;y<4;y++)for(let x=0;x<6;x++)assert.equal(result.image.data[(y*6+x)*4],x<4?30:80,"overlap uses source pixels without blending");
  assert.deepEqual(first.data,before);assert.equal(result.provenance.kind,"derived-same-coordinate-pixel-stitch");assert.equal(result.provenance.singleScreenshot,false);
  assert.deepEqual(result.provenance.sources[1].regions,[{source:{x:2,y:0,width:2,height:4},destination:{x:4,y:0,width:2,height:4}}]);
});
test("composite isolation rejects uncovered or fractional device positions rather than manufacturing pixels", async () => {
  const { stitchFidelityTiles }=await import("./render-fidelity-attribution.mjs");
  const image={width:2,height:2,data:new Uint8Array(16)},bounds={x:0,y:0,width:4,height:2};
  assert.throws(()=>stitchFidelityTiles([{image,tile:{x:0,y:0,width:2,height:2}}],{bounds,scale:1}),error=>error.code==="COMPOSITE_COVERAGE_GAP");
  assert.throws(()=>stitchFidelityTiles([{image,tile:{x:.25,y:0,width:2,height:2}}],{bounds,scale:1}),error=>error.code==="COMPOSITE_NONINTEGRAL_OFFSET");
});

test("all-text isolation audit adds every requested text without changing ordinary failure isolation", async () => {
  const {fidelityIsolationPlan}=await import("./render-fidelity-attribution.mjs");
  const rows=[{id:"pass-text",value:value(),complete:true},{id:"fail-shape",value:value(["pixel failure"]),complete:true},{id:"pass-shape",value:value(),complete:true}];
  const requested=[{id:"pass-text",type:"text"},{id:"fail-shape",type:"rectangle"},{id:"pass-shape",type:"rectangle"}];
  assert.deepEqual(fidelityIsolationPlan(rows,requested),[{id:"fail-shape",reasonCodes:["RAW_COMPARISON_FAILED"]}]);
  assert.deepEqual(fidelityIsolationPlan(rows,requested,{isolateAllText:true}),[{id:"fail-shape",reasonCodes:["RAW_COMPARISON_FAILED"]},{id:"pass-text",reasonCodes:["ALL_TEXT_ISOLATION_AUDIT"]}]);
  const missing=fidelityIsolationPlan(rows,[...requested,{id:"missing-text",type:"text"}],{isolateAllText:true});
  assert.deepEqual(missing.find(row=>row.id==="missing-text").reasonCodes,["NO_CAPTURE_INTERSECTION","ALL_TEXT_ISOLATION_AUDIT"]);
});
