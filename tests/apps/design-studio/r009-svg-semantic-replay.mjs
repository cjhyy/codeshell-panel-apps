// Offline, bounded semantic audit. Inputs and their original failures stay intact.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {resolve, join} from "node:path";
import {normalizeDesignDocument} from "../../../apps/design-studio/app/document.mjs";
import {browserPaintBoxes} from "../../../apps/design-studio/app/canvas/browser-paint-box.mjs";
import {renderDesignFrontendPage} from "../../../apps/design-studio/app/frontend-export.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const key = row => JSON.stringify([row.page, row.id, row.route, row.matrix]);
const epsilon = 1e-9; // Numerical root equality only; never a visual tolerance.

function expandedRoundRect(node, tile, scale, spread) {
  const radius = Math.min(node.cornerRadius ?? 0, node.width / 2, node.height / 2);
  return {x:(node.x - tile.x - spread)*scale, y:(node.y - tile.y - spread)*scale,
    width:(node.width + 2*spread)*scale, height:(node.height + 2*spread)*scale,
    radius:Math.max(0, radius + spread)*scale};
}

function signedDistance(box, x, y) {
  const r = Math.min(box.radius, box.width/2, box.height/2);
  const qx = Math.abs(x - box.x - box.width/2) - box.width/2 + r;
  const qy = Math.abs(y - box.y - box.height/2) - box.height/2 + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// The captured probe points outward from a convex contour. Starting at an
// interior point brackets its unique outward boundary, including rounded arcs.
function outwardIntersection(box, probe) {
  const at = t => signedDistance(box, probe.x + t*probe.nx, probe.y + t*probe.ny);
  const inward = Math.min(probe.medialDistance/2, 8);
  let low = -inward, high = 8;
  if (!(inward > 0) || at(low) > epsilon || at(high) < -epsilon) return null;
  for (let i=0; i<64; i++) {
    const middle = (low + high)/2;
    if (at(middle) > 0) high = middle; else low = middle;
  }
  const root = (low + high)/2;
  return Math.abs(at(root)) < 1e-7 ? root : null;
}

function ringInterval(node, tile, scale, probe) {
  const half = node.strokeWidth/2;
  const inner = expandedRoundRect(node, tile, scale, -half);
  const outer = expandedRoundRect(node, tile, scale, half);
  if (!(inner.width > 0 && inner.height > 0)) return null;
  const lo = outwardIntersection(inner, probe), hi = outwardIntersection(outer, probe);
  return lo !== null && hi !== null && hi > lo ? {lo, hi} : null;
}

function boundedProbe(delta, exact, snapped, scale) {
  const innerDisplacement = exact.lo - snapped.lo, outerDisplacement = exact.hi - snapped.hi;
  // A linear correspondence between the two interval endpoints moves every
  // point by at most this maximum. Width has the exact difference of its two
  // independently moving boundaries. These bounds are derived from boxes,
  // before reading a measured centroid/width, not fitted to the raw deltas.
  const centroidBound = Math.max(Math.abs(innerDisplacement), Math.abs(outerDisplacement));
  const widthBound = Math.abs(outerDisplacement - innerDisplacement);
  const fields = [
    {field:"centroid", observedDevicePx:delta.centroid, snapDisplacementUpperBoundDevicePx:centroidBound,
      exactGeometricDeltaDevicePx:(exact.lo + exact.hi - snapped.lo - snapped.hi)/2},
    {field:"width", observedDevicePx:delta.width, snapDisplacementUpperBoundDevicePx:widthBound,
      exactGeometricDeltaDevicePx:exact.hi - exact.lo - snapped.hi + snapped.lo}
  ].map(entry => ({...entry, allowedDevicePx:entry.snapDisplacementUpperBoundDevicePx + .1,
    observedCssPx:Math.abs(entry.observedDevicePx)/scale,
    withinCorrespondingSnapBound:Math.abs(entry.observedDevicePx) <= entry.snapDisplacementUpperBoundDevicePx + .1,
    withinHalfCssPx:Math.abs(entry.observedDevicePx)/scale <= .5}));
  return {exactIntervalDevicePx:exact, snappedIntervalDevicePx:snapped, innerDisplacementDevicePx:innerDisplacement,
    outerDisplacementDevicePx:outerDisplacement, fields,
    bounded:fields.every(entry=>entry.withinCorrespondingSnapBound && entry.withinHalfCssPx)};
}

function selfTest() {
  const node={x:10,y:10,width:20,height:12,cornerRadius:3,strokeWidth:1};
  const probe={x:20,y:10,nx:0,ny:-1,medialDistance:6};
  const exact=ringInterval(node,{x:0,y:0},1,probe);
  assert(Math.abs(exact.lo + .5)<epsilon && Math.abs(exact.hi - .5)<epsilon);
  const snapped=ringInterval({...node,y:10.4},{x:0,y:0},1,probe);
  assert(Math.abs(exact.lo - snapped.lo - .4)<epsilon);
  assert(boundedProbe({centroid:.4,width:0},exact,snapped,1).bounded);
  assert(!boundedProbe({centroid:.6,width:0},exact,snapped,1).bounded);
  assert(!boundedProbe({centroid:1.4,width:0},exact,snapped,1).bounded);
  assert(!boundedProbe({centroid:.4,width:.6},exact,snapped,1).bounded);
  const arc={x:13-3/Math.sqrt(2),y:13-3/Math.sqrt(2),nx:-1/Math.sqrt(2),ny:-1/Math.sqrt(2),medialDistance:8};
  const rounded=ringInterval(node,{x:0,y:0},1,arc);
  assert(Math.abs(rounded.lo + .5)<epsilon && Math.abs(rounded.hi - .5)<epsilon);
  return {assertions:7, passed:true};
}

if (process.argv.includes("--self-test")) {
  console.log(JSON.stringify(selfTest()));
} else {
  const [oldArg, outputArg, realArg] = process.argv.slice(2);
  assert(oldArg && outputArg && realArg, "usage: node r009-svg-semantic-replay.mjs R008_EVIDENCE OUTPUT REAL_BACKUP");
  const old=resolve(oldArg), output=resolve(outputArg), realPath=resolve(realArg);
  assert(!output.startsWith(old + "/") && output !== old, "old raw is read-only");
  const sourcePath=join(old,"final-real-rows.json"), sourceBytes=await readFile(sourcePath), realBytes=await readFile(realPath);
  const rows=JSON.parse(sourceBytes), design=normalizeDesignDocument(JSON.parse(realBytes).document);
  const selected=rows.filter(row=>row.offline?.blockerClass === "SVG_PRECISE_UNEXPLAINED_STROKE");
  assert.equal(selected.length,235,"R008 denominator must remain exact");
  assert.equal(new Set(selected.map(key)).size,235,"unique source rows");
  const pages=new Map(design.pages.map(page=> {
    const html=renderDesignFrontendPage(design,{pageId:page.id});
    const tags=new Map([...html.matchAll(/<[^>]*data-codeshell-id="([^"]+)"[^>]*>/g)].map(match=>[match[1],match[0]]));
    return [page.id,{nodes:page.nodes,paint:browserPaintBoxes(page.nodes),tags}];
  }));
  const results=[];
  for (const row of selected) {
    const page=pages.get(row.page), authored=page.nodes.find(node=>node.id===row.id), node={...authored,...row.geometry};
    assert(authored && row.route === "svg");
    for (const field of ["x","y","width","height"]) assert.equal(authored[field],row.geometry[field],"raw geometry must match authored document");
    const snap=page.paint.nodes.get(row.id), value=row.value, probes=[];
    const result={page:row.page,id:row.id,matrix:row.matrix,route:row.route,scale:row.scale,unit:"unique (page,node,route,matrix)",
      exactBoxCss:{x:node.x,y:node.y,width:node.width,height:node.height,cornerRadius:node.cornerRadius},
      snappedBoxCss:snap?{x:snap.x,y:snap.y,width:snap.width,height:snap.height,cornerRadius:snap.cornerRadius}:null,
      rawGeometryFailures:value.geometryFailures,rawGateFailures:value.gateFailures,rawStrokeContourCoverage:value.strokeContourCoverage??null,
      rawUnavailableStrokeRays:value.strokeEdges?.unavailable??null,paths:row.paths,probes,bounded:false};
    results.push(result);
    if (!value.strokeDeltas?.length) {result.status="UNPROVEN_FILL_WITHOUT_STROKE_PROBES";continue;}
    const tag=page.tags.get(row.id) ?? "";
    result.exportProof={source:"offline reconstruction with frontend-export.mjs; not fresh computed CSS",marker:tag.match(/data-codeshell-stroke="([^"]*)"/)?.[1]??null,
      boxShadow:tag.match(/box-shadow:([^;\"]*)/)?.[1]??null};
    if (!snap || page.paint.fallbackReasons.has(row.id) || node.rotation || node.type !== "rectangle" || node.strokeWidth !== 1 ||
      node.strokeAlign || node.cornerRadii || node.strokeSides || node.shadow || node.shadowStack || node.fillPaints ||
      node.opacity !== 1 || node.cornerRadius < node.strokeWidth/2 || result.exportProof.marker !== "legacy-shadow-v1" ||
      result.exportProof.boxShadow !== `0 0 0 0.5px ${node.stroke},inset 0 0 0 0.5px ${node.stroke}`) {
      result.status="UNPROVEN_UNSUPPORTED_SEMANTICS";continue;
    }
    // Every existing matched probe is tested. Missing rays remain explicit and
    // cannot silently reduce the old minimum-16 visibility contract.
    const actual=value.strokeEdges, coverage=value.strokeContourCoverage;
    if (!actual?.measurable || value.primaryAvailable !== true || !coverage || coverage.matched<16 ||
      coverage.referenceVisible !== coverage.matched || coverage.actualVisible !== coverage.matched) {
      result.status="UNPROVEN_INCOMPLETE_MATCHED_PROBES";continue;
    }
    for (const delta of value.strokeDeltas) {
      const probe=actual.probes.find(probe=>probe.edge===delta.edge && probe.fraction===delta.fraction);
      const exact=probe && ringInterval(node,row.tile,row.scale,probe), snapped=probe && ringInterval(snap,row.tile,row.scale,probe);
      const entry={index:probe?.index??null,fraction:delta.fraction,normal:probe?{x:probe.x,y:probe.y,nx:probe.nx,ny:probe.ny}:null,
        rawDeltaDevicePx:{centroid:delta.centroid,width:delta.width}};
      probes.push(entry);
      if (!exact || !snapped) {entry.status="UNPROVEN_NO_UNIQUE_OUTWARD_INTERVAL";entry.bounded=false;continue;}
      Object.assign(entry,boundedProbe(delta,exact,snapped,row.scale));
      entry.status=entry.bounded?"BOUNDED_EXACT_VS_SNAPPED":"OUTSIDE_SEMANTIC_BOUND";
    }
    result.bounded=probes.length===coverage.matched && probes.every(probe=>probe.bounded);
    result.status=result.bounded?"BOUNDED_EXACT_VS_SNAPPED":probes.some(probe=>!probe.fields)?"UNPROVEN_NO_UNIQUE_OUTWARD_INTERVAL":"OUTSIDE_SEMANTIC_BOUND";
  }
  const stroke=results.filter(row=>row.probes.length), bounded=results.filter(row=>row.bounded);
  const fields=stroke.flatMap(row=>row.probes.flatMap(probe=>(probe.fields??[]).map(field=>({...field,page:row.page,id:row.id,matrix:row.matrix,fraction:probe.fraction}))));
  const summary={rows:results.length,sourceNodes:new Set(results.map(row=>row.id)).size,strokeRows:stroke.length,
    strokeSourceNodes:new Set(stroke.map(row=>row.id)).size,
    fillRowsWithoutStrokeProbes:results.filter(row=>row.status==="UNPROVEN_FILL_WITHOUT_STROKE_PROBES").length,
    fillSourceNodesWithoutStrokeProbes:new Set(results.filter(row=>row.status==="UNPROVEN_FILL_WITHOUT_STROKE_PROBES").map(row=>row.id)).size,
    boundedRows:bounded.length,remainingRows:results.length-bounded.length,
    byMatrix:Object.fromEntries([...new Set(results.map(row=>row.matrix))].map(matrix=>{const subset=results.filter(row=>row.matrix===matrix);return[matrix,{rows:subset.length,bounded:subset.filter(row=>row.bounded).length,remaining:subset.filter(row=>!row.bounded).length}];})),
    matchedProbes:stroke.reduce((sum,row)=>sum+row.probes.length,0),fields:fields.length,
    correspondingBoundExceedances:fields.filter(field=>!field.withinCorrespondingSnapBound).length,
    halfCssPxExceedances:fields.filter(field=>!field.withinHalfCssPx).length,
    maximumAbsoluteObservedCssPx:Math.max(...fields.map(field=>field.observedCssPx)),
    maximumCorrespondingBoundExcessDevicePx:Math.max(...fields.map(field=>Math.abs(field.observedDevicePx)-field.allowedDevicePx)),
    statusCounts:Object.fromEntries([...new Set(results.map(row=>row.status))].map(status=>[status,results.filter(row=>row.status===status).length]))};
  const receipt={createdUtc:new Date().toISOString(),derivedOffline:true,rawCapturesChanged:false,rawFailuresRetained:true,
    interpretation:"finite exact-vs-snapped SVG semantics registration only; no claim of HTML pixel equality; every other SVG category remains governed by its original gates",
    rule:"each matched raw centroid and width absolute delta <= its independently derived corresponding geometric snap displacement bound + .1 device px, and <= .5 CSS px",
    geometryProof:"axis-aligned uniform-radius centered 1 CSS px ring only; exact and snapped rounded-rectangle inner/outer boundary intersections along each existing probe normal; monotone interval endpoint correspondence bounds centroid displacement, exact interval-length change bounds width displacement",
    limitations:["79 fill-only rows do not have matched stroke probes and remain unproven", "offline source-generated CSS proof, not fresh computed CSS", "unavailable raw rays remain unavailable; original minimum-16 matched visibility contract retained", "raw pixel mismatch/cluster and all original failures remain intact", "geometric semantic bound is not an AA pixel qualification"],
    source:{path:sourcePath,sha256:sha(sourceBytes)},sourceDocument:{path:realPath,sha256:sha(realBytes)},
    sourceModules:await Promise.all(["document.mjs","frontend-export.mjs","corner-radii.mjs","canvas/browser-paint-box.mjs"].map(async name=>{
      const path=resolve("apps/design-studio/app",name);return {path,sha256:sha(await readFile(path))};
    })),
    selfTest:selfTest(),summary,
    maximumViolationExamples:{halfCss:[...fields].sort((a,b)=>b.observedCssPx-a.observedCssPx)[0],
      correspondingBound:[...fields].sort((a,b)=>(Math.abs(b.observedDevicePx)-b.allowedDevicePx)-(Math.abs(a.observedDevicePx)-a.allowedDevicePx))[0],
      widthCss:[...fields].filter(field=>field.field==="width").sort((a,b)=>b.observedCssPx-a.observedCssPx)[0]},
    unprovenFillSources:[...new Map(results.filter(row=>row.status==="UNPROVEN_FILL_WITHOUT_STROKE_PROBES").map(row=>[row.id,{page:row.page,id:row.id}])).values()],
    exceedances:fields.filter(field=>!field.withinCorrespondingSnapBound||!field.withinHalfCssPx),rows:results};
  await mkdir(output,{recursive:true});
  await writeFile(join(output,"semantic-boundary.json"),JSON.stringify(receipt,null,2)+"\n");
  await writeFile(join(output,"summary.json"),JSON.stringify({...receipt,rows:undefined,exceedances:undefined},null,2)+"\n");
  assert.equal(sha(await readFile(sourcePath)),receipt.source.sha256,"old raw changed");
  assert.equal(sha(await readFile(realPath)),receipt.sourceDocument.sha256,"user source changed");
  console.log(JSON.stringify(summary,null,2));
}
