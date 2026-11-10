import assert from "node:assert/strict";
import { test } from "node:test";
import { auditRotatedFillBounds } from "./render-fidelity-audit.mjs";

function receipt({delta=2,diagnostic=false,isolation=false,type="rectangle",length=10,thickness=2}={}) {
  const moments=(l,t)=>({centroidX:10,centroidY:10,covarianceXX:l*l/12,covarianceXY:0,covarianceYY:t*t/12});
  const value={primaryAvailable:true,geometryScope:"own-fill-leaf",geometryProbe:{kind:"rotation",measurable:true,failures:[],
    reference:moments(10,2),actual:moments(length,thickness),localLongEdgeCss:10,scale:1},
    delta:{measurable:true,left:delta,top:0,right:0,bottom:0,centroidX:.1,centroidY:.1},
    geometryFailures:[],failures:[],gateFailures:[],diagnosticFailures:[],gating:diagnostic?"diagnostic":"primary-and-secondary",
    pixel:{mismatchRatio:.004,largestCluster:2},pixelQualification:{geometryPassed:true,rawPass:false,qualified:true,status:"qualified-aa-pass",raw:{mismatchRatio:.004,largestCluster:2},refined:{mismatchRatio:0,largestCluster:0}}};
  return {matrix:diagnostic?"dpr1-fit-view":"dpr2-zoom1",page:"page",id:"rotated",type,route:"gpu",complete:true,isolation:isolation?{targetId:"rotated"}:null,value};
}
const report=rows=>({uniqueRecords:rows,failures:[],summary:{},unmeasured:[],partialNodes:[],fontOmissions:[]});

test("rotated fill bounds revoke AA, restore raw pixels, and preserve immutable source evidence",()=>{
  const original=report([receipt()]),before=structuredClone(original),audited=auditRotatedFillBounds(original,{path:"source/report.json",sha256:"source-hash"});
  assert.deepEqual(original,before);
  const row=audited.uniqueRecords[0],value=row.value;
  assert(value.geometryFailures.some(reason=>reason.startsWith("rotated fill left")));
  assert.equal(value.pixelQualification.qualified,false);assert.equal(value.pixelQualification.refined,null);
  assert.equal(value.preRotatedBoundsAudit.pixelQualification.status,"qualified-aa-pass");
  assert(value.gateFailures.some(reason=>reason.startsWith("pixel mismatch")));
  assert.equal(audited.rotatedBoundsAudit.unresolvedWithoutIsolation.length,1);
  assert.equal(audited.sourceReport.sha256,"source-hash");
  assert.equal(audited.summary.truefail,1);
});

test("rotated bounds audit accepts inclusive one-pixel integer AA bounds and preserves text",()=>{
  const rows=[receipt({delta:1}),receipt({type:"text"})],audited=auditRotatedFillBounds(report(rows));
  assert.deepEqual(audited.uniqueRecords[0].value.geometryFailures,[]);
  assert.equal(audited.uniqueRecords[0].value.pixelQualification.qualified,true);
  assert.deepEqual(audited.uniqueRecords[1],rows[1]);
  assert.equal(audited.rotatedBoundsAudit.revokedAa,0);
});

test("rotated moment gates reject length, thickness, noninteger bbox and unavailable raw moments",()=>{
  const missing=receipt({delta:0});delete missing.value.geometryProbe.reference;
  for(const row of [receipt({delta:0,length:11}),receipt({delta:0,thickness:2.5}),receipt({delta:.5}),missing]){
    const value=auditRotatedFillBounds(report([row])).uniqueRecords[0].value;
    assert.ok(value.geometryFailures.length);
    assert.equal(value.pixelQualification.qualified,false);
  }
  assert.equal(auditRotatedFillBounds(report([missing])).uniqueRecords[0].value.primaryAvailable,false);
});

test("diagnostic matrices remain diagnostic and isolated bounds failures are not mislabeled unresolved",()=>{
  const audited=auditRotatedFillBounds(report([receipt({diagnostic:true,isolation:true})])),value=audited.uniqueRecords[0].value;
  assert.deepEqual(value.gateFailures,[]);assert(value.diagnosticFailures.length>=2);
  assert.equal(audited.rotatedBoundsAudit.unresolvedWithoutIsolation.length,0);
  assert.equal(audited.summary.truefail,0);assert.equal(audited.summary.diagnosticFailures,1);
});
