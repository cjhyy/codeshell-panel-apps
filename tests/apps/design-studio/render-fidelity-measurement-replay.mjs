// Read-only R006 measurement audit of existing raw PNGs. Output is create-only;
// neither old reports nor original screenshots are updated.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {normalizeDesignDocument} from '../../../apps/design-studio/app/document.mjs';
import {browserPaintBoxes} from '../../../apps/design-studio/app/canvas/browser-paint-box.mjs';
import {coverageGeometry} from './render-fidelity-geometry.mjs';
import {parseRgb,symmetricPixelDifference} from './render-fidelity.metrics.mjs';
import {selectUniqueMeasurements,classifySvgPreciseSnap,attributeFrameComposite} from './render-fidelity-attribution.mjs';
const [input,fixture,output]=process.argv.slice(2);assert(input&&fixture&&output,'report.json real-fixture.json output-directory required');
await mkdir(output,{recursive:true});
const bytes=await readFile(input),source=await readFile(fixture),report=JSON.parse(bytes),design=normalizeDesignDocument(JSON.parse(source).document);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert(report.real,'this offline audit requires the read-only real design fixture');assert.equal(report.inputSha256,sha(source));
const records=[...report.records,...report.isolationRecords],rows=selectUniqueMeasurements(records);
const pages=new Map(design.pages.map(page=>[page.id,{nodes:page.nodes,paint:browserPaintBoxes(page.nodes)}]));
const groups=new Map();for(const row of rows){if(!groups.has(row.recordIndex))groups.set(row.recordIndex,[]);groups.get(row.recordIndex).push(row);}
const changes=[],frameRows=[];
const oldStrict=rows.filter(row=>row.matrix!=='dpr1-fit-view'&&row.matrix!=='dpr1-zoom05');
const oldGate=oldStrict.filter(row=>row.value.gateFailures?.length).length;
for(const [recordIndex,group]of groups){
  const record=records[recordIndex],{nodes,paint}=pages.get(record.page),images={};
  const get=async route=>images[route]??=(PNG.sync.read(await readFile(record.paths[route])));
  for(const row of group){
    const node=nodes.find(n=>n.id===row.id),value=row.value;
    if(!node||row.route==='html')continue;
    const container=['frame','component','group'].includes(node.type)&&nodes.some(n=>n.parentId===node.id);
    const svgCandidate=row.route==='svg'&&(value.gateFailures?.length||value.preSvgSnapGateFailures?.length);
    if(!container&&!svgCandidate)continue;
    const {tile,scale}=record,angle=(node.rotation??0)*Math.PI/180;
    const inset=Math.max(8,(Math.abs(node.width*Math.cos(angle))+Math.abs(node.height*Math.sin(angle))-node.width)/2+4,(Math.abs(node.width*Math.sin(angle))+Math.abs(node.height*Math.cos(angle))-node.height)/2+4);
    const left=Math.max(node.x-inset,tile.x),top=Math.max(node.y-inset,tile.y),right=Math.min(node.x+node.width+inset,tile.x+tile.width),bottom=Math.min(node.y+node.height+inset,tile.y+tile.height);
    const roi={x:(left-tile.x)*scale,y:(top-tile.y)*scale,width:(right-left)*scale,height:(bottom-top)*scale};
    if(container){
      value.rawCompositePixel=symmetricPixelDifference(await get('html'),await get(row.route),{roi,retainMask:true});
      if(value.rawCompositePixel.mismatchRatio>.001||value.rawCompositePixel.largestCluster>6)frameRows.push({row,record,node,nodes});
    }
    if(!svgCandidate)continue;
    const pair=Object.fromEntries(rows.filter(other=>other.page===row.page&&other.matrix===row.matrix&&other.id===row.id).map(other=>[other.route,other.value]));
    // Independent routes may select different records. Coverage is measured in
    // this shared SVG/HTML capture pair, never on rescaled or manufactured PNGs.
    let background=parseRgb(design.canvas.background),parent=nodes.find(n=>n.id===node.parentId);
    const seen=new Set();while(parent&&!seen.has(parent.id)){seen.add(parent.id);if(parseRgb(parent.fill)){background=parseRgb(parent.fill);break;}parent=nodes.find(n=>n.id===parent.parentId);}
    const foreground=parseRgb(node.fill);
    if(foreground&&background){
      value.coverageGeometry=coverageGeometry(await get('svg'),{roi,foreground,background});
      pair.html={...pair.html,coverageGeometry:coverageGeometry(await get('html'),{roi,foreground,background})};
    }
    const previous=value.svgSnapClassification??null;
    if(previous){value.gateFailures=[...value.preSvgSnapGateFailures];value.gating='primary-and-secondary';delete value.svgSnapClassification;}
    const classification=classifySvgPreciseSnap({node,snappedNode:paint.fallbackReasons.has(node.id)?null:paint.nodes.get(node.id),scale,measurements:pair,tile});
    if(classification){value.preSvgSnapGateFailures=[...value.gateFailures];value.svgSnapClassification=classification;value.gateFailures=[];value.gating='diagnostic';}
    changes.push({page:row.page,id:row.id,matrix:row.matrix,route:row.route,coverage:row.coverage,previousClassification:previous,classification,coverageGeometry:value.coverageGeometry,referenceCoverageGeometry:pair.html?.coverageGeometry,remainingGateFailures:value.gateFailures});
  }
}
const failedSnapshot=rows.map(row=>({...row,value:{...row.value,gateFailures:[...(row.value.gateFailures??[])]}}));
const frames=frameRows.map(({row,record,node,nodes})=>({page:row.page,id:row.id,matrix:row.matrix,route:row.route,coverage:row.coverage,
  strokeRing:Boolean(row.value.pixelRegion),primaryAvailable:row.value.primaryAvailable,ownFillExcluded:Boolean(row.value.observability?.excludedFromEffectiveDenominator),originalGateFailures:row.value.gateFailures,originalGeometryFailures:row.value.geometryFailures,
  classification:attributeFrameComposite({value:row.value,node,nodes,rows:failedSnapshot,page:row.page,matrix:row.matrix,route:row.route,tile:record.tile,scale:record.scale}),
  rawCompositePixel:row.value.rawCompositePixel}));
const strict=entry=>entry.matrix!=='dpr1-fit-view'&&entry.matrix!=='dpr1-zoom05';
const summary={sourceReport:{path:resolve(input),sha256:sha(bytes)},fixture:{path:resolve(fixture),sha256:sha(source)},rawCapturesChanged:false,
  oldStrictGateFailures:oldGate,svg:{strictCandidates:changes.filter(strict).length,strictClassified:changes.filter(c=>strict(c)&&c.classification).length,allClassified:changes.filter(c=>c.classification).length,
    oldStrictClassified:changes.filter(c=>strict(c)&&c.previousClassification).length,newlyClassified:changes.filter(c=>!c.previousClassification&&c.classification).length,revoked:changes.filter(c=>c.previousClassification&&!c.classification).length},
  frames:{strictCompositeFailures:frames.filter(strict).length,strictDescendantAttributed:frames.filter(c=>strict(c)&&c.classification?.kind==='DESCENDANT_ATTRIBUTED').length,strictUnattributed:frames.filter(c=>strict(c)&&c.classification?.kind==='FRAME_COMPOSITE_UNATTRIBUTED').length,
    byRoute:Object.fromEntries(['gpu','browser','svg','html'].map(route=>[route,{failures:frames.filter(c=>strict(c)&&c.route===route).length,attributed:frames.filter(c=>strict(c)&&c.route===route&&c.classification?.kind==='DESCENDANT_ATTRIBUTED').length}]))}};
await writeFile(join(output,'svg-reclassification.json'),JSON.stringify(changes,null,2)+'\n',{flag:'wx'});
await writeFile(join(output,'frame-attribution.json'),JSON.stringify(frames,null,2)+'\n',{flag:'wx'});
await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary));
