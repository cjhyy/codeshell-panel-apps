// Compare frozen baseline/candidate evidence without reading private designs.
// Usage: node .../render-fidelity-compare.mjs baseline/report.json candidate/report.json output.json
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const [baselinePath,candidatePath,outputPath]=process.argv.slice(2);
assert(baselinePath&&candidatePath&&outputPath,"baseline, candidate and output paths are required");
const baseline=JSON.parse(await readFile(baselinePath,"utf8")),candidate=JSON.parse(await readFile(candidatePath,"utf8"));
assert.equal(baseline.real,false,"finite compatibility comparison is for the isolated synthetic fixture");
assert.equal(candidate.real,false,"finite compatibility comparison is for the isolated synthetic fixture");
assert.equal(candidate.serializedSha256,baseline.serializedSha256,"baseline and candidate must use identical serialized fixture bytes");
assert.deepEqual(candidate.matrix,baseline.matrix,"matrix must be identical");
assert.deepEqual(candidate.viewport,baseline.viewport,"viewport must be identical");
assert.equal(candidate.chromeExclusion,baseline.chromeExclusion,"comparison chrome exclusion must be identical");
for(const field of ["chromium","platform","arch"])assert.equal(candidate.environment[field],baseline.environment[field],`same ${field} is required`);
assert.deepEqual(candidate.fontAvailability,baseline.fontAvailability,"font availability evidence must be identical");
const key=entry=>`${entry.matrix}/${entry.page}/${entry.id}`;
const oldSvg=new Map(baseline.finiteCompatibility.map(entry=>[key(entry),entry]));
const gpuCrops=report=>new Map(report.records.flatMap(record=>(record.nodes??[]).map(node=>[`${record.matrix}/${record.page}/${node.id}`,node.measurements.gpu?.cropSha256])));
const oldGpu=gpuCrops(baseline),newGpu=gpuCrops(candidate);
const compatibility=candidate.finiteCompatibility.map(entry=>({key:key(entry),svgStringUnchanged:entry.svg===oldSvg.get(key(entry))?.svg,
  gpuPixelsUnchanged:Boolean(oldGpu.get(key(entry)))&&oldGpu.get(key(entry))===newGpu.get(key(entry)),
  oldGpuSha256:oldGpu.get(key(entry))??null,newGpuSha256:newGpu.get(key(entry))??null}));
const result={serializedSha256:candidate.serializedSha256,baseline:baselinePath,candidate:candidatePath,
  baselineSummary:baseline.summary,candidateSummary:candidate.summary,finiteCompatibility:compatibility,
  finiteCompatibilityPassed:compatibility.length===oldSvg.size&&compatibility.length>0&&compatibility.every(entry=>entry.svgStringUnchanged&&entry.gpuPixelsUnchanged),
  visualParityPassed:candidate.summary.allMeasuredThresholdsPassed===true};
await writeFile(outputPath,JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({finiteControls:compatibility.length,finiteCompatibilityPassed:result.finiteCompatibilityPassed,visualParityPassed:result.visualParityPassed,output:outputPath}));
assert(result.finiteCompatibilityPassed,"finite-offset GPU pixels and SVG strings must remain exactly unchanged");
