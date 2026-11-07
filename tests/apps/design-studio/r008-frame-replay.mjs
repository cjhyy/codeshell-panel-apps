// Offline only: raw reports/PNGs and the real document are read-only inputs.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {PNG} from "pngjs";
import {normalizeDesignDocument} from "../../../apps/design-studio/app/document.mjs";
import {applyAllAutoLayouts} from "../../../apps/design-studio/app/layout.mjs";
import {textRangeSourceSignature} from "../../../apps/design-studio/app/text-ranges.mjs";
import {createDesignResourcePersistencePlan} from "../../../apps/design-studio/app/resource-store.mjs";
import {renderFidelityFixture} from "./render-fidelity.fixture.mjs";
import {parseRgb} from "./render-fidelity.metrics.mjs";
import {measureFrameOwnRegion} from "./render-fidelity-frame-own.mjs";

const [sourceRootArg,outputArg,realPathArg]=process.argv.slice(2);
assert(sourceRootArg&&outputArg&&realPathArg,"usage: node r008-frame-replay.mjs R007_EVIDENCE OUTPUT REAL_BACKUP");
const sourceRoot=resolve(sourceRootArg),output=resolve(outputArg),realPath=resolve(realPathArg);
assert(!output.startsWith(sourceRoot+"/"),"source evidence must not be written");
await mkdir(output,{recursive:true});
const hash=bytes=>createHash("sha256").update(bytes).digest("hex"),matrices=["dpr1-zoom1","dpr2-zoom1","dpr1-zoom2","dpr2-zoom1-fractionalpan"],routes=["gpu","browser","svg","html"];
const syntheticSource=renderFidelityFixture({textRangeSourceSignature}),fontBytes=await readFile(new URL("../../../apps/design-studio/app/fonts/InterVariable.woff2",import.meta.url));
const font=await createDesignResourcePersistencePlan({id:"fidelity-inter",kind:"font",mime:"font/woff2",base64:fontBytes.toString("base64"),family:"Fidelity Inter",weight:400,style:"normal",sha256Bytes:hash});syntheticSource.resources.push(font.descriptor);
const realBytes=await readFile(realPath),real=normalizeDesignDocument(JSON.parse(realBytes).document),synthetic=normalizeDesignDocument(syntheticSource);
for(const page of synthetic.pages)applyAllAutoLayouts(page.nodes);
const backgroundFor=(node,nodes,canvas)=>{const index=new Map(nodes.map(n=>[n.id,n]));for(let parent=index.get(node.parentId),seen=new Set();parent&&!seen.has(parent.id);parent=index.get(parent.parentId)){seen.add(parent.id);const color=parseRgb(parent.fill);if(color)return color;}return parseRgb(canvas.background)??[255,255,255];};
const identity=row=>({page:row.page,id:row.id,type:row.type,route:row.route,matrix:row.matrix,coverage:row.coverage});
const totals=rows=>({unique:rows.length,rawCompositeFail:rows.filter(r=>r.result.rawCompositePixel?.mismatchRatio>.001||r.result.rawCompositePixel?.largestCluster>6).length,
  effectiveRawCompositeFail:rows.filter(r=>!r.value.observability?.excludedFromEffectiveDenominator&&(r.result.rawCompositePixel?.mismatchRatio>.001||r.result.rawCompositePixel?.largestCluster>6)).length,
  ownPass:rows.filter(r=>r.result.pass).length,ownFail:rows.filter(r=>r.result.observable&&!r.result.pass).length,ownUnobservable:rows.filter(r=>!r.result.observable).length,
  ownFillEffectiveDenominator:rows.filter(r=>r.result.ownFillObservable).length,ownFillPass:rows.filter(r=>r.result.ownFillObservable&&r.result.ownFill?.pass).length,ownFillFail:rows.filter(r=>r.result.ownFillObservable&&!r.result.ownFill?.pass).length,ownFillUnobservable:rows.filter(r=>!r.result.ownFillObservable).length,
  ringEffectiveDenominator:rows.filter(r=>r.result.ring).length,ringPass:rows.filter(r=>r.result.ring?.pass).length,
  ownGeometryFail:rows.filter(r=>r.result.ownFillObservable&&r.result.geometryFailures.length).length,ringFail:rows.filter(r=>r.result.ring&&!r.result.ring.pass).length,
  unobservableOwnFillWithMeasuredRing:rows.filter(r=>!r.result.ownFillObservable&&r.result.ring).length,
  previouslyFailedToOwnPass:rows.filter(r=>r.value.gateFailures.length&&r.result.pass).length,remainingMaskedAreaDevicePx2:rows.reduce((sum,r)=>sum+(r.result.region?.maskedPixels??0),0)});
const receipt={createdUtc:new Date().toISOString(),policy:"all complete independently measured descendants, pass or fail, have reference/actual ink union + 2 device px masked from frame own fill; stroke ring is always independently unmasked; original composite diagnostics and every child result remain unchanged; fully masked own paint is unobservable, never pass",sourceDocument:{path:realPath,sha256:hash(realBytes)},sourceReportsChanged:false,sections:{}};
for(const [name,design]of [["real",real],["synthetic",synthetic]]){
  const sourcePath=join(sourceRoot,`final-${name}`,"strict-audited-report.json"),bytes=await readFile(sourcePath),report=JSON.parse(bytes),allRows=report.uniqueRecords.filter(row=>matrices.includes(row.matrix));
  const selected=allRows.filter(row=>["frame","component","group"].includes(row.type)&&row.value.rawCompositePixel),groups=new Map(),results=[];
  for(const row of selected){const key=JSON.stringify([row.paths.html,row.paths[row.route]]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  for(const group of groups.values()){
    const reference=PNG.sync.read(await readFile(group[0].paths.html)),actual=group[0].route==="html"?reference:PNG.sync.read(await readFile(group[0].paths[group[0].route]));
    for(const row of group){const nodes=design.pages.find(page=>page.id===row.page)?.nodes??design.nodes,sourceNode=nodes.find(node=>node.id===row.id);assert(sourceNode,`missing ${name} source node ${row.id}`);
      const node={...sourceNode,...row.geometry},result=measureFrameOwnRegion({reference,actual,value:row.value,node,nodes,rows:allRows,page:row.page,matrix:row.matrix,route:row.route,tile:row.tile,scale:row.scale,background:backgroundFor(sourceNode,nodes,design.canvas)});
      assert(result);results.push({...row,result});
    }
  }
  const section={source:{path:sourcePath,sha256:hash(bytes),bytes:bytes.length},sourceUnique:allRows.length,summary:totals(results),byRoute:Object.fromEntries(routes.map(route=>[route,totals(results.filter(row=>row.route===route))])),
    ownUnobservableReasons:Object.fromEntries([...new Set(results.filter(row=>!row.result.observable).map(row=>row.result.reason))].map(reason=>[reason,results.filter(row=>!row.result.observable&&row.result.reason===reason).length])),
    failedRows:results.filter(row=>row.result.observable&&!row.result.pass).map(row=>({...identity(row),gateFailures:row.result.gateFailures,geometryFailures:row.result.geometryFailures,ringGateFailures:row.result.ring?.gateFailures??null,region:row.result.region,pixel:row.result.pixel,paths:row.paths})),
    unobservableRows:results.filter(row=>!row.result.observable).map(row=>({...identity(row),reason:row.result.reason,region:row.result.region,originalObservability:row.value.observability??null,paths:row.paths}))};
  const target=join(output,`${name}-frame-own.json`);await writeFile(target,JSON.stringify({source:section.source,rows:results},null,2)+"\n");section.rowsEvidence={path:target,sha256:hash(await readFile(target))};receipt.sections[name]=section;
  console.log(JSON.stringify({section:name,summary:section.summary,byRoute:section.byRoute}));
  assert.equal(hash(await readFile(sourcePath)),section.source.sha256,"raw source report changed during replay");
}
assert.equal(hash(await readFile(realPath)),receipt.sourceDocument.sha256,"real source document changed during replay");
await writeFile(join(output,"receipt.json"),JSON.stringify(receipt,null,2)+"\n");
await writeFile(join(output,"summary.json"),JSON.stringify({...receipt,sections:Object.fromEntries(Object.entries(receipt.sections).map(([name,{failedRows,unobservableRows,...section}])=>[name,section]))},null,2)+"\n");
