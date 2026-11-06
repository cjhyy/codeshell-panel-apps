/* Test-only attribution. Raw tile receipts are immutable evidence; unique
 * receipts choose geometry coverage before looking at any measurement result. */
export const fidelityMeasurementKey = row => JSON.stringify([row.page,row.id,row.route,row.matrix]);
export function selectUniqueMeasurements(records) {
  const selected = new Map();
  for (const [recordIndex,record] of records.entries()) for (const node of record.nodes ?? []) {
    for (const [route,value] of Object.entries(node.measurements)) {
      const isolation=record.isolation?.targetId===node.id;
      const row={matrix:record.matrix,page:record.page,id:node.id,type:node.type,route,recordIndex,tileIndex:record.tileIndex,
        coverage:isolation?(node.complete?(record.composite?"isolation-full-composite":"isolation-full"):"isolation-partial"):(node.complete?"full":"partial"),
        complete:node.complete,clearance:node.clearance??0,reasonCode:node.complete?null:"NO_COMPLETE_TILE",
        isolation:isolation?record.isolation:null,value,diagnosticReasons:node.diagnosticReasons??[],paths:record.paths};
      const key=fidelityMeasurementKey(row),previous=selected.get(key);
      // An isolated result is authoritative even if it exposes a failure. It
      // must never win because its measured error happened to be smaller.
      const rank=entry=>(entry.complete?1000:0)+(entry.isolation?100:0);
      if(!previous||rank(row)>rank(previous)||rank(row)===rank(previous)&&row.clearance>previous.clearance)selected.set(key,row);
    }
  }
  return [...selected.values()].sort((a,b)=>fidelityMeasurementKey(a).localeCompare(fidelityMeasurementKey(b)));
}
export function fidelityCounts(rows) {
  return {unique:rows.length,full:rows.filter(row=>row.complete).length,isolation:rows.filter(row=>row.isolation).length,
    partial:rows.filter(row=>!row.complete).length,unavailable:rows.filter(row=>!row.value.primaryAvailable).length,
    truefail:rows.filter(row=>row.value.gateFailures?.length).length,
    unclassifiedFail:rows.filter(row=>row.value.gateFailures?.length&&row.value.strokeClassification?.kind!=="html-pixel-snap").length,
    htmlPixelSnap:rows.filter(row=>row.value.strokeClassification?.kind==="html-pixel-snap").length,
    aaQualified:rows.filter(row=>row.value.pixelQualification?.status==="qualified-aa-pass").length,
    rawPixelFail:rows.filter(row=>row.value.pixelQualification?.rawPass===false).length,
    diagnostic:rows.filter(row=>row.value.gating==="diagnostic").length,
    diagnosticFailures:rows.filter(row=>row.value.diagnosticFailures?.length||row.value.gating==="diagnostic"&&row.value.failures?.length).length};
}
export function isolateFidelityDesign(input,targetId) {
  const design=structuredClone(input),index=new Map(design.nodes.map(node=>[node.id,node])),target=index.get(targetId);
  if(!target)throw Error(`Unknown isolation target ${targetId}`);
  const ancestorIds=[];
  for(let node=index.get(target.parentId);node&&!ancestorIds.includes(node.id);node=index.get(node.parentId))ancestorIds.push(node.id);
  const ancestors=new Set(ancestorIds),descendants=new Set(),hiddenIds=[];
  for(const candidate of design.nodes){for(let parent=index.get(candidate.parentId),seen=new Set();parent&&!seen.has(parent.id);parent=index.get(parent.parentId)){if(parent.id===targetId){descendants.add(candidate.id);break;}seen.add(parent.id);}}
  for(const node of design.nodes){
    if(node.id===targetId||descendants.has(node.id))continue;
    if(ancestors.has(node.id)){
      // Fill is the target's paint backdrop. All structural semantics, including
      // layout placeholders, clipping, rotation and nested opacity stay intact.
      node.stroke="transparent";
      if(node.strokeSides)node.strokeSides=node.strokeSides.map(side=>({...side,opacity:0}));
      delete node.shadow;delete node.shadowStack;
    }else{node.opacity=0;hiddenIds.push(node.id);}
  }
  for(const page of design.pages??[])page.nodes=page.id===design.activePageId?design.nodes:(page.nodes??[]).map(node=>({...node,opacity:0}));
  return {design,metadata:{version:2,targetId,ancestorIds,descendantIds:[...descendants],hiddenIds,method:"same immutable document transform on GPU/browser/SVG/HTML; opacity-zero sibling flow placeholders; target descendants retain opaque paint/clip semantics; ancestor fills and structural semantics preserved"}};
}
export function classifyHtmlPixelSnap({node,scale,measurements}) {
  const width=Number(node.strokeWidth)||0,outset=node.strokeAlign==="inside"?0:node.strokeAlign==="outside"?width:width/2;
  const edges=[node.x-outset,node.y-outset,node.x+node.width+outset,node.y+node.height+outset].map(value=>value*scale);
  if(!edges.some(value=>Math.abs(value-Math.round(value))>1e-6))return null;
  const sets=["gpu","svg","html"].map(route=>measurements[route]?.strokeEdges);
  if(sets.some(set=>!set?.measurable||set.probes.length<12))return null;
  const [gpu,svg,html]=sets.map(set=>set.probes);
  let gpuSvg=0,gpuHtml=0;
  for(let i=0;i<gpu.length;i++){
    if(svg[i]?.edge!==gpu[i].edge||html[i]?.edge!==gpu[i].edge||svg[i].fraction!==gpu[i].fraction||html[i].fraction!==gpu[i].fraction)return null;
    for(const field of ["centroid","width"]){
      if(![gpu[i][field],svg[i][field],html[i][field]].every(Number.isFinite))return null;
      gpuSvg=Math.max(gpuSvg,Math.abs(gpu[i][field]-svg[i][field]));gpuHtml=Math.max(gpuHtml,Math.abs(gpu[i][field]-html[i][field]));
    }
  }
  if(gpuSvg>.1+1e-9||gpuHtml>1+1e-9||gpuHtml<=.35)return null;
  return {kind:"html-pixel-snap",pass:false,fractionalDeviceEdges:edges.filter(value=>Math.abs(value-Math.round(value))>1e-6),
    maximumGpuSvg:gpuSvg,maximumGpuHtml:gpuHtml,basis:gpu.every(probe=>probe.edge==="contour")?`${gpu.length} matched center-contour normals; geometry exception only; pixel failures retained`:"12 matched probes across all four edges; geometry exception only; pixel failures retained"};
}

/** Derived evidence, not a screenshot: copy each pixel from exactly one raw
 * same-position tile. Overlap is audited but never averaged or repainted. */
export function stitchFidelityTiles(tiles,{bounds,scale,maxPixels=32*1024*1024}) {
  const fail=(code,message)=>{const error=Error(message);error.code=code;throw error;};
  const integer=value=>Number.isFinite(value)&&Math.abs(value-Math.round(value))<=1e-6;
  if(!integer(bounds.width*scale)||!integer(bounds.height*scale))fail("COMPOSITE_NONINTEGRAL_SIZE","Composite dimensions must be integer device pixels");
  const width=Math.round(bounds.width*scale),height=Math.round(bounds.height*scale);
  if(width<=0||height<=0||width*height>maxPixels)fail("COMPOSITE_PIXEL_BUDGET","Derived evidence exceeds its explicit pixel budget");
  const data=new Uint8Array(width*height*4),covered=new Uint8Array(width*height);
  const provenance={kind:"derived-same-coordinate-pixel-stitch",singleScreenshot:false,method:"deterministic first-owner integer crop/copy; no resampling, blending, masking or color edits",bounds:{...bounds},scale,width,height,pixels:width*height,coveredPixels:0,overlapPixels:0,overlapDifferentPixels:0,maximumOverlapChannelDelta:0,sources:[]};
  for(const [sourceIndex,{image,tile,source,sourceSha256}] of tiles.entries()){
    const offsetX=(tile.x-bounds.x)*scale,offsetY=(tile.y-bounds.y)*scale;
    if(!integer(offsetX)||!integer(offsetY))fail("COMPOSITE_NONINTEGRAL_OFFSET","Tile origins must share the composite device grid");
    if(image.width!==Math.round(tile.width*scale)||image.height!==Math.round(tile.height*scale)||image.data.length!==image.width*image.height*4)fail("COMPOSITE_SOURCE_SIZE_MISMATCH","Raw tile dimensions disagree with its capture geometry");
    const dx=Math.round(offsetX),dy=Math.round(offsetY),receipt={source:source??null,sourceSha256:sourceSha256??null,sourceIndex,tile:{...tile},width:image.width,height:image.height,selectedPixels:0,regions:[]};
    // Ownership is represented as maximal same-span vertical rectangles, so
    // every derived byte can be reconstructed from the original tile paths.
    let previous=new Map();
    for(let sy=Math.max(0,-dy);sy<Math.min(image.height,height-dy);sy++){
      const current=new Map(),runs=[];let runStart=null;
      const endX=Math.min(image.width,width-dx);
      for(let sx=Math.max(0,-dx);sx<endX;sx++){
        const x=dx+sx,y=dy+sy,at=y*width+x,from=(sy*image.width+sx)*4,to=at*4;
        if(covered[at]){
          provenance.overlapPixels++;let delta=0;
          for(let channel=0;channel<4;channel++)delta=Math.max(delta,Math.abs(data[to+channel]-image.data[from+channel]));
          if(delta)provenance.overlapDifferentPixels++;provenance.maximumOverlapChannelDelta=Math.max(provenance.maximumOverlapChannelDelta,delta);
          if(runStart!==null){runs.push([runStart,sx]);runStart=null;}
        }else{
          data.set(image.data.subarray(from,from+4),to);covered[at]=1;provenance.coveredPixels++;receipt.selectedPixels++;if(runStart===null)runStart=sx;
        }
      }
      if(runStart!==null)runs.push([runStart,endX]);
      for(const [start,end]of runs){
        const key=`${start}/${end}`,existing=previous.get(key);
        if(existing&&existing.source.y+existing.source.height===sy){existing.source.height++;existing.destination.height++;current.set(key,existing);}
        else{const region={source:{x:start,y:sy,width:end-start,height:1},destination:{x:dx+start,y:dy+sy,width:end-start,height:1}};receipt.regions.push(region);current.set(key,region);}
      }
      previous=current;
    }
    provenance.sources.push(receipt);
  }
  if(provenance.coveredPixels!==width*height)fail("COMPOSITE_COVERAGE_GAP",`Missing ${width*height-provenance.coveredPixels} device pixels in raw tile coverage`);
  return {image:{width,height,data},provenance};
}

/** Mandatory failure/coverage isolation plus an explicit all-text audit. The
 * latter provides identical clean attribution even when a raw text ROI passes. */
export function fidelityIsolationPlan(rows,requested,{isolateAllText=false}={}) {
  const plan=new Map(),add=(id,reasons)=>{if(!plan.has(id))plan.set(id,new Set());for(const reason of reasons)plan.get(id).add(reason);};
  for(const row of rows){
    const reasons=[...(!row.complete?["NO_COMPLETE_TILE"]:[]),...(!row.value.primaryAvailable?(row.value.unavailableReasonCodes?.length?row.value.unavailableReasonCodes:["PRIMARY_UNAVAILABLE"]):[]),...(row.value.failures?.length?["RAW_COMPARISON_FAILED"]:[])];
    if(reasons.length)add(row.id,reasons);
  }
  for(const node of requested){
    if(!rows.some(row=>row.id===node.id))add(node.id,["NO_CAPTURE_INTERSECTION"]);
    if(isolateAllText&&node.type==="text")add(node.id,["ALL_TEXT_ISOLATION_AUDIT"]);
  }
  return [...plan].map(([id,reasons])=>({id,reasonCodes:[...reasons]}));
}
