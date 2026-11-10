import assert from "node:assert/strict";
import {test} from "node:test";
import {classifyHtmlDualShadowPhase} from "./render-fidelity-phase-attribution.mjs";
const scan=(centroid=0,width=2)=>({measurable:true,probes:["top","right","bottom","left"].flatMap(edge=>[.25,.5,.75].map(fraction=>({edge,fraction,centroid,width})))});
const options=()=>({node:{x:10.25,y:10,width:20,height:20,strokeWidth:3},tile:{x:0,y:0},scale:1,
  exportProof:{marker:"center-shadow-v1",boxShadow:"0 0 0 1.5px rgba(0,0,0,1),inset 0 0 0 1.5px rgba(0,0,0,1)"},
  measurements:{gpu:{strokeEdges:scan(.8)},svg:{strokeEdges:scan(.85)},html:{strokeEdges:scan()}}});
test("dual shadow phase requires every matched GPU/SVG probe and explicit export proof; raw failure retained",()=>{
  const input=options(),before=JSON.stringify(input),result=classifyHtmlDualShadowPhase(input);
  assert.equal(result.kind,"HTML_DUAL_SHADOW_PHASE");assert.equal(result.pass,false);assert.equal(result.probes.length,24);
  assert.equal(JSON.stringify(input),before);assert.equal(result.rawFailuresRetained,true);
  for(const mutate of [o=>delete o.exportProof,o=>o.exportProof.marker="center-outline-v1",o=>o.exportProof.boxShadow="inset 0 0 0 1px black",o=>o.node.strokeAlign="inside",o=>o.node.rotation=1,o=>o.node.x=10,
    o=>o.measurements.svg.strokeEdges.probes[11].width+=.11,o=>o.measurements.svg.strokeEdges.probes[11].width+=.1000000005,o=>o.measurements.svg.strokeEdges.probes.pop(),o=>o.measurements.html.strokeEdges.measurable=false,
    o=>o.measurements.svg.strokeEdges.probes[11].fraction=.99,o=>o.measurements.gpu.strokeEdges.probes[0].width=NaN,
    o=>o.measurements.html.strokeEdges=scan(.825)]){
    const changed=options();mutate(changed);assert.equal(classifyHtmlDualShadowPhase(changed),null);
  }
});
