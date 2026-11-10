// Offline replay only: no browser, renderer, source-document writes or old-raw writes.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {compareRotationGeometry,compareRotationMoments} from "./render-fidelity-geometry.mjs";

const oldRoot=resolve(process.argv[2]??"/Users/admin/.codex/worktrees/panels-design-render-fidelity-r007/.tmp/render-fidelity-r007");
const output=resolve(process.argv[3]??".tmp/render-fidelity-r008/moments");
assert.notEqual(output,oldRoot);
await mkdir(output,{recursive:true});
const registryPath=resolve(oldRoot,"rotation-final-registry.json"),spikePath=resolve(oldRoot,"rotation/spike.json");
const registryBytes=await readFile(registryPath),spikeBytes=await readFile(spikePath);
const registry=JSON.parse(registryBytes),spike=JSON.parse(spikeBytes);
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const rows=registry.rows.map(row=>{
  const previous=row.boundedRotationGeometry,measurement=compareRotationMoments(previous?.reference,previous?.actual,
    {localLongEdgeCss:row.localLongEdgeCss,scale:previous?.scale});
  const bboxFailures=Object.entries(row.bboxEdges??{}).flatMap(([edge,delta])=>!Number.isInteger(delta)?
    [`rotated fill ${edge} ${delta} is not an integer ink-bbox delta`]:Math.abs(delta)>1?[`rotated fill ${edge} ${delta} > 1`]:[]);
  if(Object.keys(row.bboxEdges??{}).length!==4)bboxFailures.push("rotated fill bbox ink not measurable");
  const failures=[...measurement.failures,...bboxFailures];
  return {page:row.page,id:row.id,matrix:row.matrix,route:row.route,isolated:row.isolated,coverage:row.coverage,
    sourceRotationDegrees:row.sourceRotationDegrees,sourceCornerRadius:row.sourceCornerRadius,savedBox:row.savedBox,
    areaRatio:row.areaRatio,rawBboxEdges:row.bboxEdges,rawBboxMaxDevicePx:row.bboxMaxDevicePx,
    measurement,failures,geometryPass:row.isolated&&row.available&&measurement.measurable&&failures.length===0,
    classification:failures.length?"BLOCKED_ROTATION_GEOMETRY":"ROTATION_GEOMETRY_PASS_ONLY",
    priorStrictGateFailures:row.gateFailures,rawPixel:row.pixel,priorPixelQualification:row.pixelQualification,
    paths:{reference:row.htmlReferencePath,actual:row.routePath}};
});
const spikeRows=spike.results.map(row=>{
  const measurement=compareRotationMoments(row.reference,row.actual,{localLongEdgeCss:row.localLongEdgeCss,scale:row.dpr});
  return {id:row.id,dpr:row.dpr,cornerRadius:row.saved.cornerRadius,areaRatio:row.areaRatio,measurement,
    geometryPass:measurement.measurable&&measurement.failures.length===0};
});

// Supersampled device-space raster controls independently exercise all gates.
const raster=(length=30,thickness=4,angleDegrees=15,dx=0)=>{
  const width=100,height=100,data=new Uint8Array(width*height*4).fill(255),samples=8,angle=angleDegrees*Math.PI/180;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let hit=0;
    for(let sy=0;sy<samples;sy++)for(let sx=0;sx<samples;sx++){
      const px=x+(sx+.5)/samples-50-dx,py=y+(sy+.5)/samples-50;
      hit+=Math.abs(px*Math.cos(angle)+py*Math.sin(angle))<length/2&&Math.abs(-px*Math.sin(angle)+py*Math.cos(angle))<thickness/2;
    }
    for(let c=0;c<3;c++)data[(y*width+x)*4+c]=Math.round(255*(1-hit/samples**2));
  }
  return {width,height,data};
};
const reference=raster(),controls=[
  {id:"length-plus-1-device-px",actual:raster(31),expected:"rotation length"},
  {id:"thickness-plus-0.5-device-px",actual:raster(30,4.5),expected:"rotation thickness"},
  {id:"translation-plus-1-device-px",actual:raster(30,4,15,1),expected:"rotation centroid"},
  {id:"30-device-px-plus-2-deg",actual:raster(30,4,17),expected:"rotation endpoint"},
].map(({actual,...control})=>({...control,measurement:compareRotationGeometry(reference,actual,{localLongEdgeCss:30,scale:1})}));
for(const control of controls)assert(control.measurement.failures.some(reason=>reason.startsWith(control.expected)),control.id);

const distribution=values=>{
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
  return {count:sorted.length,min:sorted[0]??null,p50:sorted[Math.floor((sorted.length-1)*.5)]??null,
    p95:sorted[Math.floor((sorted.length-1)*.95)]??null,max:sorted.at(-1)??null};
};
const uniqueNodes=items=>new Set(items.map(row=>`${row.page}/${row.id}`)).size;
const summary=items=>({rows:items.length,uniqueNodes:uniqueNodes(items),geometryPass:items.filter(row=>row.geometryPass).length,
  geometryFail:items.filter(row=>!row.geometryPass).length,uniqueFailedNodes:uniqueNodes(items.filter(row=>!row.geometryPass)),
  unavailable:items.filter(row=>!row.measurement.measurable).length,
  failureCounts:Object.fromEntries(["centroid","endpoint","length","thickness","fill"].map(kind=>{
    const failed=items.filter(row=>row.failures.some(reason=>reason.startsWith(`rotation ${kind}`)||kind==="fill"&&reason.startsWith("rotated fill")));
    return [kind,{rows:failed.length,uniqueNodes:uniqueNodes(failed)}];
  })),
  signedLengthDeltaDevicePx:distribution(items.map(row=>row.measurement.lengthDeltaDevicePx)),
  signedThicknessDeltaDevicePx:distribution(items.map(row=>row.measurement.thicknessDeltaDevicePx)),
  absoluteLengthDeltaDevicePx:distribution(items.map(row=>Math.abs(row.measurement.lengthDeltaDevicePx))),
  absoluteThicknessDeltaDevicePx:distribution(items.map(row=>Math.abs(row.measurement.thicknessDeltaDevicePx))),
  centroidDevicePx:distribution(items.map(row=>row.measurement.centroid)),endpointDevicePx:distribution(items.map(row=>row.measurement.endpointDevicePx))});
const group=(items,key)=>Object.fromEntries([...new Set(items.map(key))].sort().map(value=>[value,summary(items.filter(row=>key(row)===value))]));
const result={created:new Date().toISOString(),status:rows.some(row=>!row.geometryPass)?"BLOCKED":"ROTATION_GEOMETRY_PASS_ONLY",
  policy:"Offline existing R007 raw moments. Leff=sqrt(12 lambdaMajor), Teff=sqrt(12 lambdaMinor) are coverage-equivalent device-pixel dimensions; short rounded-strip AA limits are retained as failures, never physical-width equivalence or exemptions. All original captures/gates remain immutable. Geometry pass alone is not a pixel or product pass.",
  thresholds:{lengthDeltaDevicePx:.5,thicknessDeltaDevicePx:.35,centroidDevicePx:.5,endpointDevicePx:.5,integerBboxEdgeDevicePx:1},
  provenance:{registryPath,registrySha256:sha(registryBytes),spikePath,spikeSha256:sha(spikeBytes),source:registry.provenance},
  summary:summary(rows),byRoute:group(rows,row=>row.route),byRouteMatrix:group(rows,row=>`${row.route}/${row.matrix}`),
  byNode:group(rows,row=>`${row.page}/${row.id}`),spike:{rows:spikeRows.length,geometryPass:spikeRows.filter(row=>row.geometryPass).length,
    geometryFail:spikeRows.filter(row=>!row.geometryPass).length,
    maxAbsoluteLengthDeltaDevicePx:Math.max(...spikeRows.map(row=>Math.abs(row.measurement.lengthDeltaDevicePx))),
    maxAbsoluteThicknessDeltaDevicePx:Math.max(...spikeRows.map(row=>Math.abs(row.measurement.thicknessDeltaDevicePx))),rows:spikeRows},
  negativeControls:controls,rows};
await writeFile(resolve(output,"rotation-moments.json"),JSON.stringify(result,null,2)+"\n");
const gpu=rows.filter(row=>row.route==="gpu"),gpuFailed=gpu.filter(row=>!row.geometryPass);
const lines=["# R008 offline rotation moments","",`Status: ${result.status}. Existing raw replay; no capture.`,"",
  "| Route / matrix | Rows | Geometry fail | Failed source nodes | ΔL min / max | ΔT min / max |",
  "| --- | ---: | ---: | ---: | ---: | ---: |",
  ...Object.entries(result.byRouteMatrix).map(([key,value])=>`| ${key} | ${value.rows} | ${value.geometryFail} | ${value.uniqueFailedNodes} | ${value.signedLengthDeltaDevicePx.min} / ${value.signedLengthDeltaDevicePx.max} | ${value.signedThicknessDeltaDevicePx.min} / ${value.signedThicknessDeltaDevicePx.max} |`),"",
  `GPU remaining: ${gpuFailed.length} comparator-unique rows / ${uniqueNodes(gpuFailed)} source nodes. Short rounded-strip AA/Skia subpixel thickness limits are BLOCKED, not pass.`,"",
  "| GPU failed node | Failed matrices | max abs ΔL | max abs ΔT |",
  "| --- | --- | ---: | ---: |",
  ...[...new Set(gpuFailed.map(row=>`${row.page}/${row.id}`))].sort().map(key=>{
    const items=gpuFailed.filter(row=>`${row.page}/${row.id}`===key);
    return `| ${key} | ${items.map(row=>row.matrix).join(", ")} | ${Math.max(...items.map(row=>Math.abs(row.measurement.lengthDeltaDevicePx)))} | ${Math.max(...items.map(row=>Math.abs(row.measurement.thicknessDeltaDevicePx)))} |`;
  }),"","All 1232 per-node/route/matrix moment values, raw bbox edges, original failures and paths are in rotation-moments.json. No known limit is converted to pass.",""];
await writeFile(resolve(output,"rotation-moments.md"),lines.join("\n"));
console.log(JSON.stringify({status:result.status,summary:result.summary,byRoute:result.byRoute,spike:{...result.spike,rows:result.spike.rows.length},negativeControls:controls.map(control=>({id:control.id,expected:control.expected,failures:control.measurement.failures}))},null,2));
