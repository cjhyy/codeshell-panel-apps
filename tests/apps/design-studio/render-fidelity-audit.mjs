// A conservative, test-only supplement for the frozen R003 capture harness.
// Raw reports and PNGs remain immutable. This receipt explicitly identifies the
// extra rotated-fill bound failures and any newly failing, unisolated evidence.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fidelityCounts } from "./render-fidelity-attribution.mjs";
import { compareRotationMoments } from "./render-fidelity-geometry.mjs";

export function auditRotatedFillBounds(report, sourceReport = {}) {
  const changed=[],unresolvedWithoutIsolation=[];
  let assessed=0,revokedAa=0;
  const uniqueRecords=report.uniqueRecords.map(row=>{
    const original=row.value;
    if(row.type==="text"||original.geometryProbe?.kind!=="rotation"||
      !["own-fill-leaf","visible-composite-fill-with-descendant-occlusion"].includes(original.geometryScope))return row;
    assessed++;
    const probe=compareRotationMoments(original.geometryProbe.reference,original.geometryProbe.actual,
      {localLongEdgeCss:original.geometryProbe.localLongEdgeCss,scale:original.geometryProbe.scale});
    const bboxFailures=original.delta?.measurable?["left","top","right","bottom"].flatMap(edge=>{
      const delta=original.delta[edge];
      return !Number.isInteger(delta)?[`rotated fill ${edge} ${delta} is not an integer ink-bbox delta`]:
        Math.abs(delta)>1?[`rotated fill ${edge} ${delta} > 1`]:[];
    }):["rotated fill bbox ink not measurable"];
    const added=[...probe.failures,...bboxFailures];
    const identity={matrix:row.matrix,page:row.page,id:row.id,route:row.route,coverage:row.coverage};
    const priorProbeFailures=new Set(original.geometryProbe.failures??[]);
    const retainedGeometry=(original.geometryFailures??[]).filter(reason=>!priorProbeFailures.has(reason)&&!reason.startsWith("rotated fill "));
    const geometryFailures=[...retainedGeometry,...added],pixel=original.pixel;
    if(!geometryFailures.length)return {...row,value:{...original,geometryProbe:{...original.geometryProbe,...probe},
      geometryFailures,rotatedBoundsAudit:{addedGeometryFailures:[],edgeThresholdDevicePx:1,integerBoundsRequired:true,classification:"geometry-pass"}}};
    const pixelFailures=pixel?[...(pixel.mismatchRatio>.001?[`pixel mismatch ${pixel.mismatchRatio} > 0.001`]:[]),
      ...(pixel.largestCluster>6?[`pixel cluster ${pixel.largestCluster} > 6`]:[])]:[];
    const failures=[...geometryFailures,...pixelFailures];
    const diagnostic=original.gating==="diagnostic",hadAa=original.pixelQualification?.status==="qualified-aa-pass";
    if(hadAa)revokedAa++;
    const value={...original,geometryProbe:{...original.geometryProbe,...probe},geometryFailures,failures,gateFailures:diagnostic?[]:failures,
      diagnosticFailures:diagnostic?failures:[],
      preRotatedBoundsAudit:{geometryFailures:original.geometryFailures,failures:original.failures,
        gateFailures:original.gateFailures,diagnosticFailures:original.diagnosticFailures,pixelQualification:original.pixelQualification},
      pixelQualification:original.pixelQualification?{...original.pixelQualification,geometryPassed:false,qualified:false,
        refined:null,status:"ineligible-rotated-moment-or-bbox-geometry"}:undefined,
      rotatedBoundsAudit:{addedGeometryFailures:added,edgeThresholdDevicePx:1,integerBoundsRequired:true,
        classification:row.isolation?"isolated-geometry-gate-failure":"unresolved-geometry-gate-failure-needs-isolation"}};
    if(!original.delta?.measurable||!probe.measurable){value.primaryAvailable=false;value.unavailableReasonCodes=[...(original.unavailableReasonCodes??[]),...(!original.delta?.measurable?["ROTATED_FILL_BBOX_UNAVAILABLE"]:[]),...(!probe.measurable?["ROTATED_FILL_MOMENTS_UNAVAILABLE"]:[])];}
    changed.push({...identity,addedGeometryFailures:added,revokedAa:hadAa});
    if(!row.isolation)unresolvedWithoutIsolation.push({...identity,addedGeometryFailures:added,
      reasonCode:"NEW_ROTATED_GEOMETRY_FAILURE_WITHOUT_ISOLATION",defectConfirmed:false});
    return {...row,value};
  });
  const counts=fidelityCounts(uniqueRecords),failures=[...(report.failures??[]).filter(failure=>failure.reasonCode),
    ...uniqueRecords.filter(row=>!row.value.observability?.excludedFromEffectiveDenominator&&row.value.gateFailures?.length).map(row=>({matrix:row.matrix,page:row.page,id:row.id,route:row.route,coverage:row.coverage,failures:row.value.gateFailures}))];
  // Copy metadata, not large duplicated tile arrays: the source receipt remains
  // the authoritative full/raw provenance and its content hash is supplied.
  const {records,isolationRecords,isolationTileRecords,rawUniqueRecords,uniqueRecords:sourceUnique,failures:sourceFailures,summary:sourceSummary,...metadata}=report;
  return {...metadata,schema:3,sourceReport,sourceSummary,uniqueRecords,failures,
    rotatedBoundsAudit:{rule:"rotated coverage moments: |delta Leff| <= .5, |delta Teff| <= .35, centroid <= .5, endpoint <= .5 device px; integer ink-bbox edge delta <= 1. Failed geometry revokes conditional AA and restores raw pixel gate. Short rounded-strip moment limits are not physical-width equivalence or exemptions.",
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
