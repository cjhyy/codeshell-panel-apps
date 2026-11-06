/* Pixel measurements are independent of renderer implementations. Coordinates
 * and thresholds are device pixels; an absent/ambiguous probe is not a pass. */
export const FIDELITY_THRESHOLDS = Object.freeze({ channel: 24, radius: 1,
  textMismatchRatio: .005, shapeMismatchRatio: .001, largestCluster: 6,
  textTopBottom1: 1, textTopBottom2: 2, textLeft: 1, textAlignedEdge: 1.5,
  textCentroid: .75, strokeCentroid: .35, strokeWidth: .35, childEdge: .5 });

function region(image, roi = {}) {
  const left = Math.max(0, Math.floor(roi.x ?? 0)), top = Math.max(0, Math.floor(roi.y ?? 0));
  return { left, top, right: Math.min(image.width, Math.ceil((roi.x ?? 0) + (roi.width ?? image.width))),
    bottom: Math.min(image.height, Math.ceil((roi.y ?? 0) + (roi.height ?? image.height))) };
}
export function largestConnectedCluster(mask, width, height) {
  const seen = new Uint8Array(mask.length); let largest = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    const queue = [i]; seen[i] = 1;
    for (let head = 0; head < queue.length; head++) {
      const p = queue[head], x = p % width, y = Math.floor(p / width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || seen[next] || !mask[next]) continue;
        seen[next] = 1; queue.push(next);
      }
    }
    largest = Math.max(largest, queue.length);
  }
  return largest;
}
export function symmetricPixelDifference(reference, actual, { roi, channel = 24, radius = 1 } = {}) {
  if (reference.width !== actual.width || reference.height !== actual.height) throw Error("Pixel images have different dimensions");
  const box = region(reference, roi), width = box.right - box.left, height = box.bottom - box.top;
  const mask = new Uint8Array(width * height); let mismatchPixels = 0, absoluteError = 0;
  const matches = (source, target, x, y) => {
    const start = (y * source.width + x) * 4;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= target.width || ny >= target.height) continue;
      const end = (ny * target.width + nx) * 4;
      if ([0, 1, 2, 3].every(c => Math.abs(source.data[start + c] - target.data[end + c]) <= channel)) return true;
    }
    return false;
  };
  for (let y = box.top; y < box.bottom; y++) for (let x = box.left; x < box.right; x++) {
    const i = (y * reference.width + x) * 4;
    for (let c = 0; c < 4; c++) absoluteError += Math.abs(reference.data[i + c] - actual.data[i + c]);
    if (!matches(reference, actual, x, y) || !matches(actual, reference, x, y)) {
      mask[(y - box.top) * width + x - box.left] = 1; mismatchPixels++;
    }
  }
  return { pixels: width * height, mismatchPixels, mismatchRatio: mismatchPixels / (width * height || 1),
    largestCluster: largestConnectedCluster(mask, width, height), meanAbsoluteChannelError: absoluteError / (width * height * 4 || 1),
    method: "symmetric 3x3 RGBA; union mask; 8-connected components; ROI pixel denominator", channel, radius };
}
export const parseRgb = value => /^#[a-f\d]{6}$/iu.test(value ?? "") ? [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)) : null;
function coverageProjection(pixel, foreground, background) {
  let numerator = 0, denominator = 0;
  for (let c = 0; c < 3; c++) { const direction = background[c] - foreground[c]; numerator += (background[c] - pixel[c]) * direction; denominator += direction * direction; }
  if (!denominator) return {alpha:0,error:Infinity};
  const alpha = Math.max(0, Math.min(1, numerator / denominator));
  // Reject unrelated colors instead of counting every dark object as text ink.
  const error = Math.max(...[0, 1, 2].map(c => Math.abs(pixel[c] - (background[c] + alpha * (foreground[c] - background[c])))));
  return {alpha,error};
}
function coverage(pixel,foreground,background){const result=coverageProjection(pixel,foreground,background);return result.error<=32?result.alpha:0;}
export function inkGeometry(image, { roi, foreground = [0, 0, 0], foregrounds = [foreground], background = [255, 255, 255], minimumCoverage = .15 } = {}) {
  const box = region(image, roi); let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  let mass = 0, sumX = 0, sumY = 0, pixels = 0;
  for (let y = box.top; y < box.bottom; y++) for (let x = box.left; x < box.right; x++) {
    const i = (y * image.width + x) * 4;
    const projection=foregrounds.map(color=>coverageProjection(image.data.subarray(i,i+3),color,background)).reduce((best,next)=>next.error<best.error?next:best,{alpha:0,error:Infinity});
    const alpha=projection.error<=32?projection.alpha:0;
    if (alpha < minimumCoverage) continue;
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    mass += alpha; sumX += (x + .5) * alpha; sumY += (y + .5) * alpha; pixels++;
  }
  return mass ? { left, top, right, bottom, centroidX: sumX / mass, centroidY: sumY / mass, mass, pixels } : null;
}
export function geometryDifference(reference, actual) {
  if (!reference || !actual) return { measurable: false };
  return { measurable: true, ...Object.fromEntries(["left", "top", "right", "bottom", "centroidX", "centroidY"].map(key => [key, actual[key] - reference[key]])) };
}
export function strokeScan(image, { x, y, axis = "y", halfWindow = 8, foreground = [0, 0, 0], background = [255, 255, 255], average = 5 }) {
  let mass = 0, moment = 0;
  for (let offset = -halfWindow; offset <= halfWindow; offset++) for (let across = -Math.floor(average / 2); across <= Math.floor(average / 2); across++) {
    const px = Math.round(x + (axis === "x" ? offset : across)), py = Math.round(y + (axis === "y" ? offset : across));
    if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
    const i = (py * image.width + px) * 4, alpha = coverage(image.data.subarray(i, i + 3), foreground, background) / average;
    mass += alpha; moment += (axis === "y" ? py + .5 : px + .5) * alpha;
  }
  return mass > .01 ? { width: mass, centroid: moment / mass } : null;
}
export function textGeometryFailures(delta, { scale = 1, align = "left" } = {}) {
  if (!delta.measurable) return ["ink not measurable"];
  const vertical = scale >= 2 ? 2 : 1, edge = align === "left" ? "left" : align === "right" ? "right" : "centroidX";
  const failures = [];
  for (const key of ["top", "bottom"]) if (Math.abs(delta[key]) > vertical) failures.push(`${key} ${delta[key]} > ${vertical}`);
  if (Math.abs(delta[edge]) > (align === "left" ? 1 : 1.5)) failures.push(`${edge} ${delta[edge]} exceeds alignment threshold`);
  if (Math.abs(delta.centroidY) > .75) failures.push(`centroidY ${delta.centroidY} > 0.75`);
  return failures;
}

/** Scan four flat sides at three independent positions. Only the contiguous
 * coverage segment nearest the authored stroke center is used, so an adjacent
 * same-color interior rule cannot inflate the measured width or centroid. */
export function strokeEdgeScans(image, { bounds, strokeWidth, strokeAlign = "center", cornerRadius = 0, foreground = [0,0,0], background = [255,255,255], outsideBackground = background }) {
  const probes=[],unavailable=[];
  const halfWindow=Math.ceil(strokeWidth+3),inside=strokeAlign==="inside"?strokeWidth/2:strokeAlign==="outside"?-strokeWidth/2:0;
  for(const edge of ["top","right","bottom","left"]){
    const horizontal=edge==="top"||edge==="bottom",length=horizontal?bounds.width:bounds.height;
    const margin=Math.max(cornerRadius+2,3),usable=length-2*margin;
    if(usable<2){unavailable.push({edge,reasonCode:"STROKE_NO_FLAT_EDGE"});continue;}
    const normal=edge==="top"?bounds.y+inside:edge==="bottom"?bounds.y+bounds.height-inside:edge==="left"?bounds.x+inside:bounds.x+bounds.width-inside;
    for(const fraction of [.25,.5,.75]){
      const along=(horizontal?bounds.x:bounds.y)+margin+usable*fraction,samples=[];
      for(let coordinate=Math.floor(normal-halfWindow);coordinate<=Math.ceil(normal+halfWindow);coordinate++){
        let alpha=0,valid=true;
        for(let across=-1;across<=1;across++){
          const x=horizontal?Math.floor(along)+across:coordinate,y=horizontal?coordinate:Math.floor(along)+across;
          if(x<0||y<0||x>=image.width||y>=image.height){valid=false;continue;}
          const outside=edge==="top"?y+.5<bounds.y:edge==="bottom"?y+.5>bounds.y+bounds.height:edge==="left"?x+.5<bounds.x:x+.5>bounds.x+bounds.width;
          const index=(y*image.width+x)*4;alpha+=coverage(image.data.subarray(index,index+3),foreground,outside?outsideBackground:background)/3;
        }
        samples.push({coordinate,alpha,valid});
      }
      const segments=[];let current=[];
      for(const sample of samples){if(sample.alpha>1/255){current.push(sample);}else if(current.length){segments.push(current);current=[];}}
      if(current.length)segments.push(current);
      segments.sort((a,b)=>Math.min(...a.map(s=>Math.abs(s.coordinate+.5-normal)))-Math.min(...b.map(s=>Math.abs(s.coordinate+.5-normal))));
      const segment=segments[0];
      if(!segment||segment.some(sample=>!sample.valid)||Math.min(...segment.map(sample=>Math.abs(sample.coordinate+.5-normal)))>strokeWidth/2+2){unavailable.push({edge,fraction,reasonCode:"STROKE_EDGE_INK_NOT_FOUND"});continue;}
      const width=segment.reduce((sum,sample)=>sum+sample.alpha,0),centroid=segment.reduce((sum,sample)=>sum+(sample.coordinate+.5)*sample.alpha,0)/width;
      probes.push({edge,fraction,width,centroid,expectedCenter:normal});
    }
  }
  return {measurable:unavailable.length===0&&probes.length===12,probes,unavailable,method:"four edges × three flat positions; nearest contiguous coverage component"};
}

export function shapeGeometryFailures(delta, { edge = .5, centroid = .5 } = {}) {
  if (!delta.measurable) return ["shape ink not measurable"];
  const failures=["left","top","right","bottom"].filter(key=>Math.abs(delta[key])>edge).map(key=>`shape ${key} ${delta[key]} > ${edge}`);
  const distance=Math.hypot(delta.centroidX,delta.centroidY);
  if(distance>centroid)failures.push(`shape centroid ${distance} > ${centroid}`);
  return failures;
}

/** A secondary AA diagnostic only. Never use these filtered pixels for primary
 * geometry, text, stored screenshots, or claims of raw pixel equality. */
export function deviceAaBlur(image) {
  const temporary=new Float64Array(image.data.length),data=new Float64Array(image.data.length),weights=[1,2,1];
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)for(let channel=0;channel<4;channel++){
    let value=0;for(let offset=-1;offset<=1;offset++)value+=image.data[(y*image.width+Math.min(image.width-1,Math.max(0,x+offset)))*4+channel]*weights[offset+1]/4;
    temporary[(y*image.width+x)*4+channel]=value;
  }
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)for(let channel=0;channel<4;channel++){
    let value=0;for(let offset=-1;offset<=1;offset++)value+=temporary[(Math.min(image.height-1,Math.max(0,y+offset))*image.width+x)*4+channel]*weights[offset+1]/4;
    data[(y*image.width+x)*4+channel]=value;
  }
  return {width:image.width,height:image.height,data};
}
export function shapePixelQualification(reference,actual,{roi,geometryPassed=false,containsText=false}={}) {
  const raw=symmetricPixelDifference(reference,actual,{roi}),passes=value=>value.mismatchRatio<=.001&&value.largestCluster<=6;
  let refined=null;
  if(geometryPassed&&!containsText){
    // Blur only a bounded ROI plus the exact two-pixel blur/search support.
    // This is byte-copy cropping, never resampling, and avoids full-page caches.
    const box=region(reference,roi),left=Math.max(0,box.left-2),top=Math.max(0,box.top-2),right=Math.min(reference.width,box.right+2),bottom=Math.min(reference.height,box.bottom+2);
    const extract=image=>{const width=right-left,height=bottom-top,data=new Uint8Array(width*height*4);for(let y=0;y<height;y++)data.set(image.data.subarray(((y+top)*image.width+left)*4,((y+top)*image.width+right)*4),y*width*4);return {width,height,data};};
    refined=symmetricPixelDifference(deviceAaBlur(extract(reference)),deviceAaBlur(extract(actual)),{roi:{x:box.left-left,y:box.top-top,width:box.right-box.left,height:box.bottom-box.top}});
  }
  return {raw,rawPass:passes(raw),refined,qualified:geometryPassed&&!containsText&&passes(refined),
    geometryPassed,containsText,method:"device separable [1,2,1]/4; existing symmetric pixel thresholds",
    status:containsText?"ineligible-text-descendants":!geometryPassed?"ineligible-geometry":passes(raw)?"raw-pass":passes(refined)?"qualified-aa-pass":"fail"};
}

function contourPoints({bounds,strokeWidth,strokeAlign="center",cornerRadius=0,shape="rectangle",count=32}) {
  const inset=strokeAlign==="inside"?strokeWidth/2:strokeAlign==="outside"?-strokeWidth/2:0;
  const left=bounds.x+inset,top=bounds.y+inset,width=bounds.width-2*inset,height=bounds.height-2*inset;
  if(width<=0||height<=0)return [];
  if(shape==="ellipse")return Array.from({length:count},(_,index)=>{
    const angle=(index+.5)*Math.PI*2/count,rx=bounds.width/2,ry=bounds.height/2;
    const normalX=Math.cos(angle)/rx,normalY=Math.sin(angle)/ry,length=Math.hypot(normalX,normalY),nx=normalX/length,ny=normalY/length;
    return {x:bounds.x+rx+rx*Math.cos(angle)-inset*nx,y:bounds.y+ry+ry*Math.sin(angle)-inset*ny,nx,ny,index};
  });
  const radius=Math.max(0,Math.min(cornerRadius-inset,width/2,height/2));
  const segments=[];
  const line=(x,y,dx,dy,length,nx,ny)=>{if(length>0)segments.push({length,at:t=>({x:x+dx*t,y:y+dy*t,nx,ny})});};
  const arc=(cx,cy,start)=>{if(radius>0)segments.push({length:Math.PI*radius/2,at:t=>{const angle=start+t/radius;return{x:cx+radius*Math.cos(angle),y:cy+radius*Math.sin(angle),nx:Math.cos(angle),ny:Math.sin(angle)};}});};
  line(left+radius,top,1,0,width-2*radius,0,-1);arc(left+width-radius,top+radius,-Math.PI/2);
  line(left+width,top+radius,0,1,height-2*radius,1,0);arc(left+width-radius,top+height-radius,0);
  line(left+width-radius,top+height,-1,0,width-2*radius,0,1);arc(left+radius,top+height-radius,Math.PI/2);
  line(left,top+height-radius,0,-1,height-2*radius,-1,0);arc(left+radius,top+radius,Math.PI);
  const perimeter=segments.reduce((sum,segment)=>sum+segment.length,0);
  return Array.from({length:count},(_,index)=>{let distance=(index+.5)*perimeter/count;for(const segment of segments){if(distance<=segment.length)return {...segment.at(distance),index};distance-=segment.length;}return {...segments.at(-1).at(segments.at(-1).length),index};});
}

/** Integrate coverage along 32 normal rays around the actual center contour.
 * Curved icons do not require a fictitious flat edge. Opaque/clip-obscured rays
 * remain explicitly reported; at least 16 matched rays are required. */
export function strokeContourScans(image,options) {
  const {strokeWidth,foreground=[0,0,0],background=[255,255,255],outsideBackground=background,strokeAlign="center"}=options;
  const points=contourPoints(options),probes=[],unavailable=[],step=.25,halfWindow=Math.ceil(strokeWidth+3);
  const inset=strokeAlign==="inside"?strokeWidth/2:strokeAlign==="outside"?-strokeWidth/2:0;
  const alphaAt=(x,y,outside)=>{
    const px=x-.5,py=y-.5,left=Math.floor(px),top=Math.floor(py),fx=px-left,fy=py-top;
    if(left<0||top<0||left+1>=image.width||top+1>=image.height)return null;
    let alpha=0;
    for(let dy=0;dy<=1;dy++)for(let dx=0;dx<=1;dx++){
      const i=((top+dy)*image.width+left+dx)*4;
      alpha+=coverage(image.data.subarray(i,i+3),foreground,outside?outsideBackground:background)*(dx?fx:1-fx)*(dy?fy:1-fy);
    }
    return alpha;
  };
  for(const point of points){
    const centerX=options.bounds.x+options.bounds.width/2,centerY=options.bounds.y+options.bounds.height/2;
    const medialDistance=Math.min(...[[point.x-centerX,point.nx],[point.y-centerY,point.ny]].filter(([position,normal])=>Math.abs(normal)>1e-8&&position/normal>0).map(([position,normal])=>position/normal));
    const inwardLimit=Math.min(halfWindow,medialDistance),samples=[];let outsideImage=false;
    for(let offset=-Math.floor(inwardLimit/step)*step;offset<=halfWindow;offset+=step){
      const alpha=alphaAt(point.x+point.nx*offset,point.y+point.ny*offset,offset>inset);
      if(alpha===null)outsideImage=true;samples.push({offset,alpha:alpha??0});
    }
    const segments=[];let current=[];
    for(const sample of samples){if(sample.alpha>1/255)current.push(sample);else if(current.length){segments.push(current);current=[];}}
    if(current.length)segments.push(current);
    segments.sort((a,b)=>Math.min(...a.map(s=>Math.abs(s.offset)))-Math.min(...b.map(s=>Math.abs(s.offset))));
    const segment=segments[0];
    if(outsideImage||!segment||Math.min(...segment.map(sample=>Math.abs(sample.offset)))>strokeWidth/2+2){unavailable.push({index:point.index,reasonCode:outsideImage?"STROKE_CONTOUR_OUTSIDE_CAPTURE":"STROKE_CONTOUR_OCCLUDED_OR_NO_INK"});continue;}
    if((inwardLimit===halfWindow&&segment[0].offset===-halfWindow)||segment.at(-1).offset===halfWindow){unavailable.push({index:point.index,reasonCode:"STROKE_CONTOUR_UNBOUNDED_INK"});continue;}
    const width=segment.reduce((sum,sample)=>sum+sample.alpha*step,0),centroid=segment.reduce((sum,sample)=>sum+sample.offset*sample.alpha*step,0)/width;
    probes.push({edge:"contour",fraction:point.index/points.length,index:point.index,x:point.x,y:point.y,nx:point.nx,ny:point.ny,width,centroid,expectedCenter:0,medialDistance});
  }
  return {measurable:probes.length>=16,probes,unavailable,requested:points.length,minimumMatched:16,method:"32 center-contour normals; quarter-device-pixel bilinear coverage integration; nearest contiguous component split at authored medial axis; >=16 visible rays"};
}
