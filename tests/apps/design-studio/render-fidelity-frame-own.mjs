/* Test-only frame measurements over immutable captured pixels. Descendant
 * results remain independent, including failures; their ink is never retested
 * as the containing frame's paint. The stroke ring is always measured whole. */
import { geometryDifference, largestConnectedCluster, parseRgb, shapeGeometryFailures, shapePixelQualification, strokeRingPixelRegion, symmetricPixelDifference } from "./render-fidelity.metrics.mjs";

const inside=(b,x,y)=>x>=b.x&&y>=b.y&&x<b.x+b.width&&y<b.y+b.height;
const validInk=ink=>ink&&["left","top","right","bottom"].every(key=>Number.isFinite(ink[key]))&&ink.right>=ink.left&&ink.bottom>=ink.top;
const pixelFailures=pixel=>[...(pixel.mismatchRatio>.001?[`pixel mismatch ${pixel.mismatchRatio} > 0.001`]:[]),...(pixel.largestCluster>6?[`pixel cluster ${pixel.largestCluster} > 6`]:[])];

export function frameOwnRegion({node,nodes,rows,page,matrix,route,tile,scale,roi}) {
  const index=new Map(nodes.map(entry=>[entry.id,entry])),masks=[],unmeasuredDescendants=[];
  for(const candidate of nodes){
    let descendant=false;
    for(let parent=index.get(candidate.parentId),seen=new Set();parent&&!seen.has(parent.id);parent=index.get(parent.parentId)){
      if(parent.id===node.id){descendant=true;break;}seen.add(parent.id);
    }
    if(!descendant||candidate.visible===false||candidate.opacity===0)continue;
    const row=rows.find(entry=>entry.page===page&&entry.matrix===matrix&&entry.route===route&&entry.id===candidate.id);
    if(!row?.complete||!validInk(row.referenceInk)||!validInk(row.value.ink)||!row.tile||!(row.scale>0)){
      unmeasuredDescendants.push({id:candidate.id,reason:"independent complete reference/actual ink unavailable",gateFailures:row?.value.gateFailures??null});continue;
    }
    const actual=row.value.ink,reference=row.referenceInk,ink={left:Math.min(actual.left,reference.left),top:Math.min(actual.top,reference.top),right:Math.max(actual.right,reference.right),bottom:Math.max(actual.bottom,reference.bottom)};
    masks.push({id:candidate.id,primaryAvailable:row.value.primaryAvailable??null,gateFailures:row.value.gateFailures??null,sourceTile:row.tile,sourceScale:row.scale,
      bounds:{x:(row.tile.x+ink.left/row.scale-tile.x)*scale-2,y:(row.tile.y+ink.top/row.scale-tile.y)*scale-2,width:(ink.right-ink.left+1)/row.scale*scale+4,height:(ink.bottom-ink.top+1)/row.scale*scale+4}});
  }
  const left=Math.floor(roi.x),top=Math.floor(roi.y),width=Math.ceil(roi.x+roi.width)-left,height=Math.ceil(roi.y+roi.height)-top,mask=new Uint8Array(width*height);
  for(const {bounds:b}of masks)for(let y=Math.max(top,Math.ceil(b.y-.5));y<Math.min(top+height,Math.ceil(b.y+b.height-.5));y++){
    const start=Math.max(left,Math.ceil(b.x-.5)),end=Math.min(left+width,Math.ceil(b.x+b.width-.5));
    if(end>start)mask.fill(1,(y-top)*width+start-left,(y-top)*width+end-left);
  }
  const includePixel=(x,y)=>{const px=Math.floor(x)-left,py=Math.floor(y)-top;return px<0||py<0||px>=width||py>=height||!mask[py*width+px];};
  let pixels=0,maskedPixels=0,nominalPixels=0,remainingNominalPixels=0;
  const nominal={x:(node.x-tile.x)*scale,y:(node.y-tile.y)*scale,width:node.width*scale,height:node.height*scale};
  for(let y=Math.floor(roi.y);y<Math.ceil(roi.y+roi.height);y++)for(let x=Math.floor(roi.x);x<Math.ceil(roi.x+roi.width);x++){
    const included=includePixel(x+.5,y+.5);pixels++;if(!included)maskedPixels++;
    if(inside(nominal,x+.5,y+.5)){nominalPixels++;if(included)remainingNominalPixels++;}
  }
  return {includePixel,metadata:{kind:"frame-own-region",expansionDevicePx:2,masks,unmeasuredDescendants,pixels,maskedPixels,remainingPixels:pixels-maskedPixels,
    maskedAreaDevicePx2:maskedPixels,remainingCoverage:(pixels-maskedPixels)/(pixels||1),nominalPixels,remainingNominalPixels,remainingNominalCoverage:remainingNominalPixels/(nominalPixels||1),descendantFailuresPreserved:true,sourcePixelsChanged:false}};
}

function maskedRawPixel(raw,region,reference,actual,roi) {
  if(!raw?.mismatchMask)return symmetricPixelDifference(reference,actual,{roi,includePixel:region.includePixel});
  const {bounds,width,height,runs}=raw.mismatchMask,mask=new Uint8Array(width*height);let mismatchPixels=0;
  for(const [y,start,end]of runs)for(let x=start;x<end;x++)if(region.includePixel(x+.5,y+.5)){mask[(y-bounds.top)*width+x-bounds.left]=1;mismatchPixels++;}
  return {pixels:region.metadata.remainingPixels,mismatchPixels,mismatchRatio:mismatchPixels/(region.metadata.remainingPixels||1),largestCluster:largestConnectedCluster(mask,width,height),
    meanAbsoluteChannelError:null,meanAbsoluteChannelErrorReason:"original composite aggregate is retained; own subset channel error not inferred from mismatch runs",channel:raw.channel,radius:raw.radius,
    method:"exact subset of immutable symmetric mismatch runs; same 8-connected components and own-region pixel denominator"};
}

// Same RGB projection, alpha threshold and pixel-center moments as inkGeometry,
// with the frame's identical reference/actual exclusion mask applied first.
function maskedInk(image,{roi,includePixel,foreground,background}) {
  if(!foreground||!background)return null;
  const direction=foreground.map((channel,i)=>channel-background[i]),denominator=direction.reduce((sum,v)=>sum+v*v,0);
  if(!denominator)return null;
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity,mass=0,sumX=0,sumY=0,pixels=0;
  for(let y=Math.max(0,Math.floor(roi.y));y<Math.min(image.height,Math.ceil(roi.y+roi.height));y++)for(let x=Math.max(0,Math.floor(roi.x));x<Math.min(image.width,Math.ceil(roi.x+roi.width));x++){
    if(!includePixel(x+.5,y+.5))continue;
    const i=(y*image.width+x)*4,alpha=Math.max(0,Math.min(1,direction.reduce((sum,v,c)=>sum+(image.data[i+c]-background[c])*v,0)/denominator));
    if(alpha<.15||Math.max(...foreground.map((_,c)=>Math.abs(image.data[i+c]-(background[c]+alpha*direction[c]))))>32)continue;
    left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);mass+=alpha;sumX+=(x+.5)*alpha;sumY+=(y+.5)*alpha;pixels++;
  }
  return mass?{left,top,right,bottom,centroidX:sumX/mass,centroidY:sumY/mass,mass,pixels}:null;
}

export function measureFrameOwnRegion({reference,actual,value,node,nodes,rows,page,matrix,route,tile,scale,background,roi}) {
  if(!["frame","component","group"].includes(node.type))return null;
  const raw=value.rawCompositePixel,bounds=raw?.mismatchMask?.bounds;
  roi??=bounds?{x:bounds.left,y:bounds.top,width:bounds.right-bounds.left,height:bounds.bottom-bounds.top}:null;
  if(!reference||!actual||!roi)return {kind:"FRAME_OWN_UNOBSERVABLE",pass:false,reason:"captured images or original ROI unavailable",gateFailures:["frame own region unavailable"]};
  const region=frameOwnRegion({node,nodes,rows,page,matrix,route,tile,scale,roi}),foreground=parseRgb(node.fill);
  const ring=node.strokeWidth>0&&!node.rotation?strokeRingPixelRegion({bounds:{x:(node.x-tile.x)*scale,y:(node.y-tile.y)*scale,width:node.width*scale,height:node.height*scale},strokeWidth:node.strokeWidth*scale,strokeAlign:node.strokeAlign,cornerRadius:(node.cornerRadius??0)*scale}):null;
  const ringPixel=ring?(value.pixelRegion?.kind==="stroke-center-contour-ring"?value.pixel:symmetricPixelDifference(reference,actual,{roi,includePixel:ring.includePixel})):null;
  const ringGeometryFailures=ring?[...(value.geometryFailures??["frame stroke geometry unavailable"])]:[];
  const ringFailures=ring?[...ringGeometryFailures,...pixelFailures(ringPixel)]:[];
  const geometryReference=maskedInk(reference,{roi,includePixel:region.includePixel,foreground,background}),geometryActual=maskedInk(actual,{roi,includePixel:region.includePixel,foreground,background});
  const delta=geometryDifference(geometryReference,geometryActual);
  const ownUnobservable=region.metadata.remainingPixels===0||region.metadata.remainingNominalPixels===0||!delta.measurable;
  const geometryFailures=ownUnobservable?["frame own fill not observable after descendant masking"]:shapeGeometryFailures(delta);
  const rawPixel=maskedRawPixel(raw,region,reference,actual,roi),rawPass=pixelFailures(rawPixel).length===0,geometryPassed=!ownUnobservable&&!geometryFailures.length;
  const qualification=rawPass||!geometryPassed?{raw:rawPixel,rawPass,refined:null,qualified:false,geometryPassed,containsText:false,status:geometryPassed&&rawPass?"raw-pass":"ineligible-geometry",method:"original shape gate; AA refinement unnecessary for raw pass or forbidden without geometry"}:
    shapePixelQualification(reference,actual,{roi,includePixel:region.includePixel,geometryPassed,containsText:false});
  const pixel=qualification.qualified?qualification.refined:qualification.raw;
  const fillFailures=ownUnobservable?geometryFailures:[...geometryFailures,...pixelFailures(pixel)];
  // A stroked transparent frame has an observable independent ring even when
  // its fill has no contrast. No descendant mask is applied to that ring.
  const fillHasContrast=Boolean(foreground&&background&&foreground.some((channel,i)=>channel!==background[i]));
  const fillRequired=fillHasContrast&&!value.observability?.excludedFromEffectiveDenominator;
  const observable=fillRequired?!ownUnobservable:Boolean(ring);
  const gateFailures=[...(fillRequired&&!ownUnobservable?fillFailures:[]),...ringFailures];
  return {kind:observable?"FRAME_OWN_REGION":"FRAME_OWN_UNOBSERVABLE",pass:observable&&gateFailures.length===0,
    passScope:fillRequired?(ring?"observable own fill and independently measured ring":"observable own fill"):ring?"independently measured ring only; fill remains unobservable":"none",
    reason:observable?"own fill uses original shape gate after all independently measured descendant ink masks; ring remains independent":"frame own paint has no remaining observable coverage",observable,
    ownFillRequired:fillRequired,ownFillObservable:fillRequired&&!ownUnobservable,ownFillUnobservableReason:!fillHasContrast?"own fill/background have no RGB projection contrast":ownUnobservable?"remaining own fill has no measurable ink after descendant masking":null,
    ownFill:{observable:fillRequired&&!ownUnobservable,pass:fillRequired&&!ownUnobservable&&fillFailures.length===0,gateFailures:fillRequired&&!ownUnobservable?fillFailures:[],pixel,geometryFailures:fillRequired&&!ownUnobservable?geometryFailures:[]},
    geometryReference,geometryActual,delta,geometryFailures,region:region.metadata,
    pixel,qualification,ring:ring?{region:ring.metadata,masked:false,pixel:ringPixel,geometryFailures:ringGeometryFailures,gateFailures:ringFailures,pass:ringFailures.length===0}:null,
    rawCompositePixel:raw,rawCompositePreserved:true,childResultsPreserved:true,gateFailures,unobservableReasons:observable?[]:["frame own region unobservable"],excludedFromEffectiveDenominator:!observable&&!ringFailures.length};
}
