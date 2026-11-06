// Recompute multi-paint geometry from already captured PNGs. This never
// rerenders images, changes thresholds, or alters pixel-difference results.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";
import { renderFidelityFixture } from "./render-fidelity.fixture.mjs";
import { geometryDifference, inkGeometry, parseRgb, textGeometryFailures } from "./render-fidelity.metrics.mjs";
assert(process.argv.length>2,"one or more synthetic report.json paths are required");
const fixture=renderFidelityFixture({textRangeSourceSignature:source=>JSON.stringify([source])});
const probes=new Map(fixture.pages.flatMap(page=>page.children.filter(node=>node.textRanges).map(node=>[node.id,node])));
for(const path of process.argv.slice(2)){
  const report=JSON.parse(await readFile(path,"utf8"));assert.equal(report.real,false,"real-design paints require their own source manifest");
  const changes=[];
  for(const record of report.records)for(const entry of record.nodes??[]){
    const source=probes.get(entry.id);if(!source)continue;
    const {scale,tile}=record,node=entry.geometry,inset=8;
    const left=Math.max(node.x-inset,tile.x),top=Math.max(node.y-inset,tile.y),right=Math.min(node.x+node.width+inset,tile.x+tile.width),bottom=Math.min(node.y+node.height+inset,tile.y+tile.height);
    const roi={x:(left-tile.x)*scale,y:(top-tile.y)*scale,width:(right-left)*scale,height:(bottom-top)*scale};
    const foregrounds=[source.fill,...source.textRanges.ranges.map(range=>range.fill)].map(parseRgb).filter(Boolean);
    for(const [route,value]of Object.entries(entry.measurements)){
      const image=PNG.sync.read(await readFile(record.paths[route]));
      value.ink=inkGeometry(image,{roi,foregrounds,background:[255,255,255]});
    }
    report.failures=report.failures.filter(failure=>!(failure.matrix===record.matrix&&failure.page===record.page&&failure.tileIndex===record.tileIndex&&failure.id===entry.id));
    for(const [route,value]of Object.entries(entry.measurements)){
      const before=value.delta;value.delta=geometryDifference(entry.measurements.html.ink,value.ink);value.primaryAvailable=Boolean(value.ink);
      value.failures=[...textGeometryFailures(value.delta,{scale,align:source.textAlign,centroid:!/[gjpqy]/u.test(source.text)}),...value.failures.filter(reason=>reason.startsWith("pixel"))];
      value.gateFailures=value.gating==="coarse-secondary"?value.failures.filter(reason=>reason.startsWith("pixel")):value.gating==="diagnostic"?[]:value.failures;
      changes.push({matrix:record.matrix,page:record.page,id:entry.id,route,before,after:value.delta});
      if(value.gateFailures.length)report.failures.push({matrix:record.matrix,page:record.page,tileIndex:record.tileIndex,id:entry.id,route,failures:value.gateFailures});
    }
    await writeFile(join(dirname(record.paths.html),"metrics.json"),JSON.stringify(record,null,2)+"\n");
  }
  const values=report.records.flatMap(record=>(record.nodes??[]).flatMap(node=>Object.values(node.measurements)));
  report.summary.failingChecks=report.failures.length;
  report.summary.diagnosticFailures=values.filter(value=>value.gating==="diagnostic"&&value.failures.length).length;
  report.summary.unavailablePrimary=values.filter(value=>!value.primaryAvailable).length;
  report.summary.allMeasuredThresholdsPassed=report.failures.length===0&&report.summary.diagnosticComparisons===0&&report.summary.unavailablePrimary===0&&report.unmeasured.length===0&&report.partialNodes.length===0;
  report.measurementCorrections=[...(report.measurementCorrections??[]),{kind:"range-paint-palette",method:"minimum RGB projection residual across base and range paint colors",capturedPixelsChanged:false,thresholdsChanged:false,audit:"range-palette-remeasurement.json"}];
  await writeFile(join(dirname(path),"range-palette-remeasurement.json"),JSON.stringify(changes,null,2)+"\n");
  await writeFile(path,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({path,correctedComparisons:changes.length,summary:report.summary}));
}
