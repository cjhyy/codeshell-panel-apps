import assert from "node:assert/strict";
import { test } from "node:test";
import { isolateFidelityDesign, selectUniqueMeasurements, classifyHtmlPixelSnap, classifyUnobservableOwnFill, classifySvgPreciseSnap, sameFloat32View, fidelityCounts } from "./render-fidelity-attribution.mjs";
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
  assert.deepEqual(fidelityCounts(rows),{unique:1,effectiveDenominator:1,ownFillUnobservable:0,full:1,isolation:1,partial:0,unavailable:0,effectiveUnavailable:0,truefail:0,effectiveTruefail:0,unclassifiedFail:0,htmlPixelSnap:0,aaQualified:0,rawPixelFail:0,rawCompositePixelFail:0,svgPreciseSnap:0,diagnostic:0,diagnosticFailures:0});
});
test("isolation hides siblings without removing flow; target descendants retain occlusion, clip and layout semantics", () => {
  const nodes=[{id:"a",type:"frame",fill:"#eeeeee",opacity:.6,rotation:13,clipContent:true,layout:"horizontal",strokeWidth:4,shadow:{blur:5},x:10,y:20}, {id:"target",parentId:"a",type:"frame",opacity:.4,layout:"vertical",x:20,y:30}, {id:"sibling",parentId:"a",opacity:.8,x:3,y:4}, {id:"child",parentId:"target",opacity:1}];
  const design={activePageId:"p",nodes,pages:[{id:"p",nodes}],canvas:{width:200,height:100}};const before=JSON.stringify(design);
  const isolated=isolateFidelityDesign(design,"target");const byId=new Map(isolated.design.nodes.map(n=>[n.id,n]));
  assert.equal(JSON.stringify(design),before);assert.deepEqual(byId.get("target"),nodes[1]);
  for(const field of ["fill","opacity","rotation","clipContent","layout","x","y"])assert.equal(byId.get("a")[field],nodes[0][field]);
  assert.equal(byId.get("a").strokeWidth,4);assert.equal(byId.get("a").stroke,"transparent");assert.equal(byId.get("a").shadow,undefined);
  assert.equal(byId.get("sibling").opacity,0);assert.notEqual(byId.get("sibling").visible,false,"flow placeholders remain in native layout");
  assert.deepEqual(byId.get("child"),nodes[3],"opaque children must continue occluding the same stroke/fill pixels");
  assert.deepEqual(isolated.metadata.descendantIds,["child"]);
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

test("view guard accepts only finite float32 representation equality, without a visual tolerance", () => {
  const gpu={zoom:1,panX:28.750001907348633,panY:-638},html={zoom:1,panX:28.75,panY:-638};
  assert(!sameFloat32View(gpu,html),"the frozen R003 pair is adjacent float32 values, not equivalent");
  assert(sameFloat32View({...gpu,panX:28.7500001},html),"ordinary double/float32 serialization roundoff is equivalent");
  assert(!sameFloat32View(gpu,{...html,panX:28.750004}));
  assert(!sameFloat32View(gpu,{...html,panX:NaN}));
  assert(!sameFloat32View({...gpu,zoom:Infinity},{...html,zoom:Infinity}));
});

test("same effective own fill is unobservable, preserves all colors and cannot count as pass", () => {
  const box={x:0,y:0,width:20,height:20},parent={...box,id:"p",type:"frame",fill:"#ffffff",opacity:1},node={...box,id:"n",type:"frame",parentId:"p",fill:"#ffffff",opacity:.5},child={...box,id:"c",type:"rectangle",parentId:"n",fill:"#000000"};
  const nodes=[parent,node,child],canvas={background:"#ffffff"},before=JSON.stringify(nodes);
  const classification=classifyUnobservableOwnFill(node,nodes,canvas);
  assert.equal(classification.kind,"OWN_FILL_UNOBSERVABLE");assert.equal(classification.pass,false);assert.equal(classification.colorsChanged,false);
  assert.equal(JSON.stringify(nodes),before,"classification never repaints a container or its descendants");
  const counts=fidelityCounts([{complete:true,value:{primaryAvailable:false,gateFailures:["shape ink not measurable"],observability:classification}}]);
  assert.equal(counts.truefail,1);assert.equal(counts.unavailable,1);assert.equal(counts.effectiveDenominator,0);assert.equal(counts.effectiveTruefail,0);assert.equal(counts.effectiveUnavailable,0);assert.equal(counts.ownFillUnobservable,1);
  for(const changes of [{fill:"#fffffe"},{strokeWidth:1},{shadow:{blur:1}},{shadowStack:{layers:[]}},{fillPaints:[]},{fillPaints:[{type:"SOLID",color:"#000000"}]},{fillPaints:[{type:"SOLID",color:"#ffffff",opacity:.5}]},{fillPaints:[{type:"SOLID",color:"#ffffff"},{type:"SOLID",color:"#ffffff"}]}])
    assert.equal(classifyUnobservableOwnFill({...node,...changes},nodes,canvas),null,JSON.stringify(changes));
  assert(classifyUnobservableOwnFill({...node,fillPaints:[{type:"SOLID",color:"#ffffff",opacity:1}]},nodes,canvas));
  assert.equal(classifyUnobservableOwnFill(node,[{...parent,fill:"transparent",opacity:.5},node],canvas),null,"transparent ancestor group opacity is not a flat backdrop");
  assert.equal(classifyUnobservableOwnFill(node,[parent,{...box,id:"behind",type:"rectangle",fill:"#000000",parentId:"p"},node],canvas),null,"same-color fill can cover a painted sibling and is then observable");
  assert.equal(classifyUnobservableOwnFill({...node,x:19,fill:"#000000"},[{...parent,fill:"#000000"},node],canvas),null,"background cannot be inferred outside its painted ancestor");
});

test("SVG precise/snap diagnostic requires independently passing GPU and predicted displacement within .1 device px", () => {
  const node={type:"rectangle",x:10.5,y:12,width:20,height:10},snappedNode={...node,x:11},scale=2;
  const pass={primaryAvailable:true,geometryFailures:[],gateFailures:[],pixel:{mismatchRatio:0,largestCluster:0}},svg={...pass,geometryScope:"own-fill-leaf",gateFailures:["pixel mismatch"],delta:{measurable:true,left:-1,top:0,right:-1,bottom:0,centroidX:-1,centroidY:0}};
  const measurements={gpu:pass,html:pass,svg};
  const result=classifySvgPreciseSnap({node,snappedNode,scale,measurements});
  assert.equal(result.kind,"svg-precise-vs-html-snap");assert.equal(result.pass,false);assert.equal(result.maximumResidualDevicePx,0);
  assert.equal(classifySvgPreciseSnap({node,snappedNode,scale,measurements:{...measurements,gpu:{...pass,gateFailures:["real pixel failure"]}}}),null);
  assert.equal(classifySvgPreciseSnap({node,snappedNode,scale,measurements:{...measurements,svg:{...svg,delta:{...svg.delta,left:-.899}}}}),null);
  assert.equal(classifySvgPreciseSnap({node,snappedNode,scale,measurements:{...measurements,svg:{...svg,primaryAvailable:false}}}),null);
  assert.equal(classifySvgPreciseSnap({node,snappedNode:{...node},scale,measurements}),null);
  assert.equal(classifySvgPreciseSnap({node:{...node,type:"image"},snappedNode,scale,measurements}),null,"box displacement cannot explain an image's internal pixels");
  assert.equal(classifySvgPreciseSnap({node,snappedNode,scale,measurements:{...measurements,svg:{...svg,delta:{...svg.delta,centroidX:-.8}}}}),null,"matching bounds cannot conceal unexplained interior mass");
});

test("isolation backdrop cannot establish an unobservable own fill in the original scene", () => {
  const box={x:0,y:0,width:20,height:20},parent={...box,id:"p",type:"frame",fill:"#ffffff",opacity:1},
    behind={...box,id:"behind",parentId:"p",type:"rectangle",fill:"#000000",opacity:1},
    target={...box,id:"target",parentId:"p",type:"frame",fill:"#ffffff",opacity:1};
  const source={nodes:[parent,behind,target],pages:[],canvas:{background:"#ffffff"}},isolated=isolateFidelityDesign(source,"target").design;
  assert.equal(isolated.nodes.find(node=>node.id==="behind").opacity,0);
  assert(classifyUnobservableOwnFill(isolated.nodes.find(node=>node.id==="target"),isolated.nodes,source.canvas),"the isolated flat backdrop alone cannot reveal the hidden sibling");
  assert.equal(classifyUnobservableOwnFill(source.nodes.find(node=>node.id==="target"),source.nodes,source.canvas),null,"attribution must evaluate the original source scene where the white fill covers a black sibling");
  assert.equal(source.nodes.find(node=>node.id==="behind").opacity,1,"the original source backdrop is retained for attribution");
});
