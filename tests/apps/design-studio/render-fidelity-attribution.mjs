/* Test-only attribution. Raw tile receipts are immutable evidence; unique
 * receipts choose geometry coverage before looking at any measurement result. */
export const fidelityMeasurementKey = row => JSON.stringify([row.page,row.id,row.route,row.matrix]);
// CanvasKit stores the view transform as float32. This is representation
// equality, not a visual error threshold (including at large coordinates).
export const sameFloat32View = (a,b) => ["zoom","panX","panY"].every(key=>
  Number.isFinite(a?.[key])&&Number.isFinite(b?.[key])&&Math.fround(a[key])===Math.fround(b[key]));

/** An own fill which contributes exactly no color is unobservable. It is
 * excluded from the effective denominator, never certified as a pass. */
export function classifyUnobservableOwnFill(node,nodes,canvas) {
  const rgb=value=>/^#[a-f\d]{6}$/iu.test(value??"")?[1,3,5].map(i=>parseInt(value.slice(i,i+2),16)):null;
  const singlePaint=entry=>entry.fillPaints===undefined||(entry.fillPaints.length===1&&entry.fillPaints[0].type==="SOLID"&&entry.fillPaints[0].visible!==false&&(entry.fillPaints[0].opacity??1)===1&&
    rgb(entry.fillPaints[0].color)?.every((channel,i)=>channel===rgb(entry.fill)?.[i]));
  if(node.type==="text"||node.strokeWidth>0||node.strokeSides||node.shadow||node.shadowStack||!singlePaint(node))return null;
  const fill=rgb(node.fill),opacity=node.opacity??1;if(!fill||!Number.isFinite(opacity)||opacity<0||opacity>1)return null;
  const index=new Map(nodes.map(entry=>[entry.id,entry])),chain=[],seen=new Set([node.id]);
  for(let parent=index.get(node.parentId);parent;parent=index.get(parent.parentId)){
    if(seen.has(parent.id))return null;seen.add(parent.id);chain.unshift(parent);
  }
  let background=rgb(canvas.background);if(!background)return null;
  const validBox=entry=>[entry.x,entry.y,entry.width,entry.height].every(Number.isFinite)&&entry.width>=0&&entry.height>=0;
  if(!validBox(node)||node.rotation)return null;
  const related=new Set(seen);
  for(const candidate of nodes){for(let parent=index.get(candidate.parentId),visited=new Set();parent&&!visited.has(parent.id);parent=index.get(parent.parentId)){if(parent.id===node.id){related.add(candidate.id);break;}visited.add(parent.id);}}
  // A same-color fill can still cover another sibling. Do not infer a flat
  // backdrop when another visible paint may intersect this target.
  for(const candidate of nodes){
    if(related.has(candidate.id)||candidate.visible===false||candidate.opacity===0)continue;
    const painted=rgb(candidate.fill)||candidate.type==="image"||candidate.strokeWidth>0||candidate.strokeSides||candidate.shadow||candidate.shadowStack||candidate.fillPaints?.length;
    if(!painted)continue;if(!validBox(candidate))return null;
    const angle=(candidate.rotation??0)*Math.PI/180,w=Math.abs(candidate.width*Math.cos(angle))+Math.abs(candidate.height*Math.sin(angle)),h=Math.abs(candidate.width*Math.sin(angle))+Math.abs(candidate.height*Math.cos(angle));
    const left=candidate.x+(candidate.width-w)/2,top=candidate.y+(candidate.height-h)/2;
    if(left<node.x+node.width&&left+w>node.x&&top<node.y+node.height&&top+h>node.y)return null;
  }
  for(const parent of chain){
    if(!singlePaint(parent)||parent.shadow||parent.shadowStack)return null;
    if((parent.opacity??1)!==1)return null;
    if(["transparent","none"].includes(parent.fill))continue;
    const paint=rgb(parent.fill),alpha=parent.opacity??1;
    // Group opacity with differently colored descendants cannot be inferred
    // by a single flat-background projection; keep that evidence strict.
    if(!paint||alpha!==1)return null;
    if(parent.rotation)return null;
    if(!paint.every((channel,i)=>channel===background[i])){
      if(!validBox(parent))return null;
      const radius=parent.cornerRadius??0;
      if(!Number.isFinite(radius)||parent.cornerRadii)return null;
      const hx=parent.width/2,hy=parent.height/2,r=Math.max(0,Math.min(radius,hx,hy));
      for(const x of [node.x,node.x+node.width])for(const y of [node.y,node.y+node.height]){
        const qx=Math.abs(x-parent.x-hx)-hx+r,qy=Math.abs(y-parent.y-hy)-hy+r;
        if(Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r>0)return null;
      }
    }
    background=paint;
  }
  const effective=fill.map((channel,i)=>background[i]+opacity*(channel-background[i]));
  if(!effective.every((channel,i)=>channel===background[i]))return null;
  return {kind:"OWN_FILL_UNOBSERVABLE",pass:false,excludedFromEffectiveDenominator:true,
    fill,opacity,effectiveBackground:background,effectiveFill:effective,ancestorIds:chain.map(entry=>entry.id),
    reason:"exact effective fill/background equality; no own stroke, shadow or multiple paints",colorsChanged:false};
}

/** Only an independently passing snapped GPU/HTML pair may explain an SVG
 * precise-box diagnostic. Every measured displacement must match prediction. */
export function classifySvgPreciseSnap({node,snappedNode,scale,measurements,tile={x:0,y:0}}) {
  if(!snappedNode||node.rotation||!(scale>0)||!Number.isFinite(scale))return null;
  if(!["rectangle","ellipse","frame","component","group"].includes(node.type)||node.shadow||node.shadowStack||node.strokeSides||node.fillPaints!==undefined||(node.opacity??1)!==1)return null;
  const {gpu,html,svg}=measurements;
  const passes=value=>value?.primaryAvailable&&!(value.geometryFailures?.length)&&!(value.gateFailures?.length)&&
    (value.pixelQualification?value.pixelQualification.rawPass||value.pixelQualification.qualified:value.pixel?.mismatchRatio<=.001&&value.pixel?.largestCluster<=6);
  if(!passes(gpu)||!passes(html)||!svg?.primaryAvailable||!svg.gateFailures?.length)return null;
  const shift={left:(node.x-snappedNode.x)*scale,top:(node.y-snappedNode.y)*scale,
    right:(node.x+node.width-snappedNode.x-snappedNode.width)*scale,bottom:(node.y+node.height-snappedNode.y-snappedNode.height)*scale};
  if(Object.values(shift).every(value=>value===0))return null;
  const residuals=[];
  if(svg.strokeDeltas?.length>=16){
    for(const delta of svg.strokeDeltas){
      const probe=svg.strokeEdges?.probes.find(entry=>entry.edge===delta.edge&&entry.fraction===delta.fraction);
      if(!probe||!Number.isFinite(probe.nx)||!Number.isFinite(probe.ny))return null;
      const fx=(probe.x-(node.x-tile.x)*scale)/(node.width*scale),fy=(probe.y-(node.y-tile.y)*scale)/(node.height*scale);
      const predicted=(shift.left+(shift.right-shift.left)*fx)*probe.nx+(shift.top+(shift.bottom-shift.top)*fy)*probe.ny;
      residuals.push({probe:delta.fraction,field:"centroid",observed:delta.centroid,predicted,error:Math.abs(delta.centroid-predicted)},
        {probe:delta.fraction,field:"width",observed:delta.width,predicted:0,error:Math.abs(delta.width)});
    }
  }else{
    if(!svg.delta?.measurable||svg.geometryScope!=="own-fill-leaf")return null;
    // Integer ink extrema only establish raster consistency. Fractional box
    // displacement is tested against coverage moments and integrated width.
    const coverage=svg.coverageGeometry,reference=html.coverageGeometry;
    if(!coverage||!reference)return null;
    const areaOverHeight=box=>node.type==="ellipse"?Math.PI*box.width*scale/4:
      box.width*scale-(4-Math.PI)*Math.min(node.cornerRadius??0,box.width/2,box.height/2)**2*scale/box.height;
    const predictedWidth=areaOverHeight(node)-areaOverHeight(snappedNode);
    for(const [field,observed,predicted]of [
      ["centroidX",coverage.centroidX-reference.centroidX,(shift.left+shift.right)/2],
      ["centroidY",coverage.centroidY-reference.centroidY,(shift.top+shift.bottom)/2],
      ["areaOverHeight",coverage.mass/(node.height*scale)-reference.mass/(snappedNode.height*scale),predictedWidth]]){
      if(!Number.isFinite(observed))return null;
      residuals.push({field,observed,predicted,error:Math.abs(observed-predicted)});
    }
    for(const edge of ["left","top","right","bottom"]){
      const observed=svg.delta[edge];if(!Number.isFinite(observed)||Math.abs(observed-shift[edge])>1)return null;
    }
  }
  const maximumResidual=Math.max(...residuals.map(entry=>entry.error));
  if(maximumResidual>.1)return null;
  return {kind:"svg-precise-vs-html-snap",pass:false,maximumResidualDevicePx:maximumResidual,limitDevicePx:.1,
    predictedEdgeDisplacementDevicePx:shift,integerBboxConsistencyLimitDevicePx:1,residuals,basis:"independent GPU/HTML geometry and pixels pass; all measured SVG displacements match precise-minus-snapped box prediction"};
}
export function selectUniqueMeasurements(records) {
  const selected = new Map();
  for (const [recordIndex,record] of records.entries()) for (const node of record.nodes ?? []) {
    for (const [route,value] of Object.entries(node.measurements)) {
      const isolation=record.isolation?.targetId===node.id;
      const row={matrix:record.matrix,page:record.page,id:node.id,type:node.type,route,recordIndex,tileIndex:record.tileIndex,
        coverage:isolation?(node.complete?(record.composite?"isolation-full-composite":"isolation-full"):"isolation-partial"):(node.complete?"full":"partial"),
        geometry:node.geometry,referenceInk:node.measurements.html?.ink,tile:record.tile,scale:record.scale,complete:node.complete,clearance:node.clearance??0,reasonCode:node.complete?null:"NO_COMPLETE_TILE",
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
  const effective=rows.filter(row=>!row.value.observability?.excludedFromEffectiveDenominator);
  return {unique:rows.length,effectiveDenominator:effective.length,ownFillUnobservable:rows.length-effective.length,full:rows.filter(row=>row.complete).length,isolation:rows.filter(row=>row.isolation).length,
    partial:rows.filter(row=>!row.complete).length,unavailable:rows.filter(row=>!row.value.primaryAvailable).length,
    effectiveUnavailable:effective.filter(row=>!row.value.primaryAvailable).length,
    truefail:rows.filter(row=>row.value.gateFailures?.length).length,
    effectiveTruefail:effective.filter(row=>row.value.gateFailures?.length).length,
    unclassifiedFail:rows.filter(row=>row.value.gateFailures?.length&&row.value.strokeClassification?.kind!=="html-pixel-snap").length,
    htmlPixelSnap:rows.filter(row=>row.value.strokeClassification?.kind==="html-pixel-snap").length,
    aaQualified:rows.filter(row=>row.value.pixelQualification?.status==="qualified-aa-pass").length,
    rawPixelFail:rows.filter(row=>row.value.pixelQualification?.rawPass===false).length,
    rawCompositePixelFail:rows.filter(row=>row.value.rawCompositePixel?.mismatchRatio>.001||row.value.rawCompositePixel?.largestCluster>6).length,
    svgPreciseSnap:rows.filter(row=>row.value.svgSnapClassification?.kind==="svg-precise-vs-html-snap").length,
    diagnostic:rows.filter(row=>row.value.gating==="diagnostic").length,
    diagnosticFailures:rows.filter(row=>row.value.diagnosticFailures?.length||row.value.gating==="diagnostic"&&row.value.failures?.length).length};
}
export function isolateFidelityDesign(input,targetId,{strokeOnly=false}={}) {
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
  if(strokeOnly){delete target.shadow;delete target.shadowStack;}
  for(const page of design.pages??[])page.nodes=page.id===design.activePageId?design.nodes:(page.nodes??[]).map(node=>({...node,opacity:0}));
  return {design,metadata:{version:3,targetId,strokeOnly,ancestorIds,descendantIds:[...descendants],hiddenIds,method:"same immutable document transform on GPU/browser/SVG/HTML; opacity-zero sibling flow placeholders; target descendants retain opaque paint/clip semantics; ancestor fills and structural semantics preserved"}};
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
    if(node.rotation)add(node.id,["ROTATED_OWN_FILL_ISOLATION_REQUIRED"]);
    if(node.strokeWidth>0&&(node.shadow||node.shadowStack))add(node.id,["STROKE_SHADOW_SEPARATION_REQUIRED"]);
  }
  return [...plan].map(([id,reasons])=>({id,reasonCodes:[...reasons]}));
}


/** Every raw composite mismatch must lie in a genuinely failing descendant's
 * actual rotated bbox, expanded by exactly two device pixels. No pixel is
 * removed: the complete mismatch runs and coverage counts stay reviewable. */
export function attributeFrameComposite({value,node,nodes,rows,page,matrix,route,tile,scale}) {
  const raw=value.rawCompositePixel;
  if(!raw||(raw.mismatchRatio<=.001&&raw.largestCluster<=6))return null;
  const index=new Map(nodes.map(entry=>[entry.id,entry]));
  const descendants=nodes.filter(candidate=>{
    for(let parent=index.get(candidate.parentId),seen=new Set();parent&&!seen.has(parent.id);parent=index.get(parent.parentId)){
      if(parent.id===node.id)return true;seen.add(parent.id);
    }return false;
  });
  const failed=descendants.flatMap(candidate=>{
    const row=rows.find(entry=>entry.page===page&&entry.matrix===matrix&&entry.route===route&&entry.id===candidate.id);
    if(!row?.value.gateFailures?.length||row.value.geometryScope==="visible-composite-fill-with-descendant-occlusion"||
      row.value.gateFailures.every(reason=>reason.startsWith("frame composite contains")))return [];
    const actualInk=row.value.ink,referenceInk=row.referenceInk??actualInk;
    if(!actualInk||!referenceInk||!row.tile||!(row.scale>0))return [];
    const ink={left:Math.min(actualInk.left,referenceInk.left),top:Math.min(actualInk.top,referenceInk.top),right:Math.max(actualInk.right,referenceInk.right),bottom:Math.max(actualInk.bottom,referenceInk.bottom)};
    return [{id:candidate.id,failures:[...row.value.gateFailures],basis:"union of reference/actual observed ink bboxes from chosen descendant capture",sourceTile:row.tile,sourceScale:row.scale,
      bounds:{x:(row.tile.x+ink.left/row.scale-tile.x)*scale-2,y:(row.tile.y+ink.top/row.scale-tile.y)*scale-2,
        width:(ink.right-ink.left+1)/row.scale*scale+4,height:(ink.bottom-ink.top+1)/row.scale*scale+4}}];
  });
  let coveredPixels=0,totalPixels=0;
  for(const [y,start,end]of raw.mismatchMask?.runs??[])for(let x=start;x<end;x++){
    totalPixels++;if(failed.some(({bounds:b})=>x+.5>=b.x&&x+.5<b.x+b.width&&y+.5>=b.y&&y+.5<b.y+b.height))coveredPixels++;
  }
  const complete=Boolean(raw.mismatchMask)&&totalPixels===raw.mismatchPixels;
  const attributed=complete&&totalPixels>0&&coveredPixels===totalPixels;
  return {kind:attributed?"DESCENDANT_ATTRIBUTED":"FRAME_COMPOSITE_UNATTRIBUTED",pass:false,
    expansionDevicePx:2,totalMismatchPixels:raw.mismatchPixels,maskMismatchPixels:totalPixels,
    coveredMismatchPixels:coveredPixels,uncoveredMismatchPixels:totalPixels-coveredPixels,maskComplete:complete,failedDescendants:failed,
    reason:attributed?"all original mismatch pixels lie inside failed descendants plus 2 device px":"frame composite has unexplained mismatch pixels or no complete mismatch mask"};
}
