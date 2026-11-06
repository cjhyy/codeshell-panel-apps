// A conservative, test-only supplement for the frozen R003 capture harness.
// Raw reports and PNGs remain immutable. This receipt explicitly identifies the
// extra rotated-fill bound failures and any newly failing, unisolated evidence.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fidelityCounts } from "./render-fidelity-attribution.mjs";

export function auditRotatedFillBounds(report, sourceReport = {}) {
  const changed=[],unresolvedWithoutIsolation=[];
  let assessed=0,revokedAa=0;
  const uniqueRecords=report.uniqueRecords.map(row=>{
    const original=row.value;
    if(row.type==="text"||original.geometryProbe?.kind!=="rotation"||
      !["own-fill-leaf","visible-composite-fill-with-descendant-occlusion"].includes(original.geometryScope))return row;
    assessed++;
    const added=original.delta?.measurable?["left","top","right","bottom"]
      .filter(edge=>Math.abs(original.delta[edge])>.5)
      .map(edge=>`rotated fill ${edge} ${original.delta[edge]} > 0.5`):["rotated fill bbox ink not measurable"];
    if(!added.length)return row;
    const identity={matrix:row.matrix,page:row.page,id:row.id,route:row.route,coverage:row.coverage};
    const geometryFailures=[...(original.geometryFailures??[]),...added],pixel=original.pixel;
    const pixelFailures=pixel?[...(pixel.mismatchRatio>.001?[`pixel mismatch ${pixel.mismatchRatio} > 0.001`]:[]),
      ...(pixel.largestCluster>6?[`pixel cluster ${pixel.largestCluster} > 6`]:[])]:[];
    const failures=[...(original.failures??[]).filter(reason=>!reason.startsWith("pixel")),...added,...pixelFailures];
    const diagnostic=original.gating==="diagnostic",hadAa=original.pixelQualification?.status==="qualified-aa-pass";
    if(hadAa)revokedAa++;
    const value={...original,geometryFailures,failures,gateFailures:diagnostic?[]:failures,
      diagnosticFailures:diagnostic?failures:[],
      preRotatedBoundsAudit:{geometryFailures:original.geometryFailures,failures:original.failures,
        gateFailures:original.gateFailures,diagnosticFailures:original.diagnosticFailures,pixelQualification:original.pixelQualification},
      pixelQualification:original.pixelQualification?{...original.pixelQualification,geometryPassed:false,qualified:false,
        refined:null,status:"ineligible-rotated-bbox-geometry"}:undefined,
      rotatedBoundsAudit:{addedGeometryFailures:added,edgeThresholdDevicePx:.5,
        classification:row.isolation?"isolated-bbox-gate-failure":"unresolved-bbox-gate-failure-needs-isolation"}};
    if(!original.delta?.measurable){value.primaryAvailable=false;value.unavailableReasonCodes=[...(original.unavailableReasonCodes??[]),"ROTATED_FILL_BBOX_UNAVAILABLE"];}
    changed.push({...identity,addedGeometryFailures:added,revokedAa:hadAa});
    if(!row.isolation)unresolvedWithoutIsolation.push({...identity,addedGeometryFailures:added,
      reasonCode:"NEW_ROTATED_BBOX_FAILURE_WITHOUT_ISOLATION",defectConfirmed:false});
    return {...row,value};
  });
  const counts=fidelityCounts(uniqueRecords),failures=[...(report.failures??[]).filter(failure=>failure.reasonCode),
    ...uniqueRecords.filter(row=>!row.value.observability?.excludedFromEffectiveDenominator&&row.value.gateFailures?.length).map(row=>({matrix:row.matrix,page:row.page,id:row.id,route:row.route,coverage:row.coverage,failures:row.value.gateFailures}))];
  // Copy metadata, not large duplicated tile arrays: the source receipt remains
  // the authoritative full/raw provenance and its content hash is supplied.
  const {records,isolationRecords,isolationTileRecords,rawUniqueRecords,uniqueRecords:sourceUnique,failures:sourceFailures,summary:sourceSummary,...metadata}=report;
  return {...metadata,schema:3,sourceReport,sourceSummary,uniqueRecords,failures,
    rotatedBoundsAudit:{rule:"rotated painted-fill bounds <= 0.5 device px per edge; centroid/angle thresholds unchanged; failed bounds revoke conditional AA and restore raw pixel gate",
      rawEvidenceUnmodified:true,assessed,changed:changed.length,revokedAa,changedRows:changed,unresolvedWithoutIsolation},
    summary:{...sourceSummary,...counts,failingChecks:failures.length,unavailablePrimary:counts.effectiveUnavailable,
      diagnosticComparisons:counts.diagnostic,allMeasuredThresholdsPassed:failures.length===0&&counts.diagnostic===0&&counts.effectiveUnavailable===0&&
        !(report.unmeasured??[]).length&&!(report.partialNodes??[]).length&&!(report.fontOmissions??[]).length&&unresolvedWithoutIsolation.length===0}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [input,output]=process.argv.slice(2);
  if(!input||!output)throw Error("Usage: node render-fidelity-audit.mjs source-report.json strict-audited-report.json");
  if(resolve(input)===resolve(output))throw Error("The immutable source report must not be overwritten");
  const bytes=await readFile(input),report=JSON.parse(bytes),audited=auditRotatedFillBounds(report,{path:resolve(input),sha256:createHash("sha256").update(bytes).digest("hex")});
  await writeFile(output,JSON.stringify(audited,null,2)+"\n");
  console.log(JSON.stringify({output,summary:audited.summary,rotatedBoundsAudit:{assessed:audited.rotatedBoundsAudit.assessed,changed:audited.rotatedBoundsAudit.changed,revokedAa:audited.rotatedBoundsAudit.revokedAa,unresolvedWithoutIsolation:audited.rotatedBoundsAudit.unresolvedWithoutIsolation.length}}));
}
