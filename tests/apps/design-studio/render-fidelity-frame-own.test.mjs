import assert from "node:assert/strict";
import {test} from "node:test";
import {frameOwnRegion,measureFrameOwnRegion} from "./render-fidelity-frame-own.mjs";
import {strokeContourScans,symmetricPixelDifference} from "./render-fidelity.metrics.mjs";

const image=()=>({width:64,height:64,data:new Uint8Array(64*64*4).fill(255)});
function box(output,{x,y,width,height,color}) {for(let py=y;py<y+height;py++)for(let px=x;px<x+width;px++){const i=(py*output.width+px)*4;for(let c=0;c<3;c++)output.data[i+c]=color;}return output;}
const frame={id:"f",type:"frame",x:8,y:8,width:48,height:48,fill:"#808080"},child={id:"c",parentId:"f",type:"rectangle",x:24,y:24,width:8,height:8};
const descendant=(failures=[])=>({page:"p",matrix:"m",route:"gpu",id:"c",tile:{x:0,y:0},scale:1,complete:true,referenceInk:{left:24,top:24,right:31,bottom:31},value:{primaryAvailable:true,gateFailures:failures,ink:{left:24,top:24,right:31,bottom:31}}});
const options={node:frame,nodes:[frame,child],page:"p",matrix:"m",route:"gpu",tile:{x:0,y:0},scale:1,background:[255,255,255],roi:{x:0,y:0,width:64,height:64}};
const scene=()=>box(box(image(),{...frame,color:128}),{...child,color:0});
const measure=(reference,actual,extra={})=>measureFrameOwnRegion({...options,rows:[descendant()],reference,actual,value:{geometryFailures:[],rawCompositePixel:symmetricPixelDifference(reference,actual,{retainMask:true})},...extra});

test("frame own region masks passing and failing independent children and preserves all original results",()=>{
  const reference=scene(),actual=box(scene(),{...child,color:255});
  for(const failures of [[],["child true geometry failure"]]){
    const rows=[descendant(failures)],before=JSON.stringify(rows),result=measure(reference,actual,{rows});
    assert(result.pass);assert(result.rawCompositePixel.mismatchPixels>0);assert.equal(result.rawCompositePreserved,true);
    assert.equal(result.region.maskedPixels,144);assert.equal(result.region.remainingPixels,4096-144);assert.equal(result.region.masks[0].gateFailures.length,failures.length);
    assert.equal(JSON.stringify(rows),before,"failed child remains present and failed independently");
  }
});
test("30-channel frame fill change outside children fails the unchanged shape pixel gate",()=>{
  const reference=scene(),actual=box(scene(),{x:10,y:10,width:10,height:10,color:158}),result=measure(reference,actual);
  assert.equal(result.pass,false);assert(result.gateFailures.some(reason=>reason.startsWith("pixel")));assert(result.pixel.mismatchRatio>.001);
});
test("a fully masked nominal frame is unobservable and cannot count as pass",()=>{
  const rows=[{...descendant(),referenceInk:{left:8,top:8,right:55,bottom:55},value:{primaryAvailable:true,gateFailures:[],ink:{left:8,top:8,right:55,bottom:55}}}],result=measure(scene(),scene(),{rows});
  assert.equal(result.kind,"FRAME_OWN_UNOBSERVABLE");assert.equal(result.pass,false);assert.equal(result.region.remainingNominalPixels,0);assert.equal(result.excludedFromEffectiveDenominator,true);
  assert(result.region.remainingPixels>0,"ROI padding alone cannot certify invisible own fill");
});
test("reference and actual ink union is transformed to frame device space with exactly 2px expansion",()=>{
  const row={...descendant(),tile:{x:10,y:20},scale:2,referenceInk:{left:10,top:20,right:19,bottom:29},value:{primaryAvailable:true,gateFailures:["failed"],ink:{left:12,top:21,right:21,bottom:31}}};
  const region=frameOwnRegion({...options,rows:[row],tile:{x:12,y:22},scale:1,roi:{x:0,y:0,width:64,height:64}});
  assert.deepEqual(region.metadata.masks[0].bounds,{x:1,y:6,width:10,height:10});
  assert.equal(region.includePixel(1.5,6.5),false);assert.equal(region.includePixel(.5,6.5),true);
  assert.equal(frameOwnRegion({...options,rows:[{...row,value:{...row.value,primaryAvailable:false}}]}).metadata.masks.length,1,"valid independent ink still masks when another child geometry probe is unavailable");
  assert.equal(frameOwnRegion({...options,rows:[{...row,complete:false}]}).metadata.masks.length,0,"partial measurements do not fabricate independent ink masks");
});
test("frame ring is measured without descendant masking and rejects an injected 1px stroke move",()=>{
  const node={...frame,fill:"transparent",stroke:"#000000",strokeWidth:2,strokeAlign:"inside"};
  const stroke=(dy=0)=>{const output=image();for(const entry of [{x:8,y:8+dy,width:48,height:2},{x:8,y:54+dy,width:48,height:2},{x:8,y:10+dy,width:2,height:44},{x:54,y:10+dy,width:2,height:44}])box(output,{...entry,color:0});return output;};
  const reference=stroke(),actual=stroke(1),scanOptions={bounds:{x:8,y:8,width:48,height:48},strokeWidth:2,strokeAlign:"inside"},expected=strokeContourScans(reference,scanOptions),observed=strokeContourScans(actual,scanOptions);
  const geometryFailures=observed.probes.flatMap(probe=>{const original=expected.probes.find(other=>other.index===probe.index);return original&&Math.abs(probe.centroid-original.centroid)>.35?["stroke centroid > .35"]:[];});
  assert(geometryFailures.length>0);
  const rows=[{...descendant(),referenceInk:{left:0,top:0,right:63,bottom:63},value:{primaryAvailable:true,gateFailures:[],ink:{left:0,top:0,right:63,bottom:63}}}],result=measure(reference,actual,{node,nodes:[node,child],rows,value:{geometryFailures,rawCompositePixel:symmetricPixelDifference(reference,actual,{retainMask:true})}});
  assert.equal(result.region.remainingPixels,0);assert.equal(result.ring.masked,false);assert(result.ring.pixel.pixels>0);assert.equal(result.ring.pass,false);assert.equal(result.pass,false);assert(result.gateFailures.some(reason=>reason.includes("stroke centroid")));
});
