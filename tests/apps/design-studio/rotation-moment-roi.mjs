// Own-fill moment region for isolated rotated shapes. Device pixels throughout.
// Wide color projection may admit a different ancestor surface as faint ink.
// Keep the source transformed bounds AND both full-ROI measured ink bounds,
// so this region cannot discard a measured displacement. One extra device
// pixel retains the AA fringe below inkGeometry's primary .15 coverage bound.
export function rotationMomentRoi({node,tile={x:0,y:0},scale=1,referenceInk,actualInk}) {
  if(!referenceInk||!actualInk)return null;
  const angle=(node.rotation??0)*Math.PI/180,cx=(node.x+node.width/2-tile.x)*scale,cy=(node.y+node.height/2-tile.y)*scale;
  const halfWidth=(Math.abs(Math.cos(angle)*node.width)+Math.abs(Math.sin(angle)*node.height))*scale/2;
  const halfHeight=(Math.abs(Math.sin(angle)*node.width)+Math.abs(Math.cos(angle)*node.height))*scale/2;
  const left=Math.min(cx-halfWidth,referenceInk.left,actualInk.left)-1,top=Math.min(cy-halfHeight,referenceInk.top,actualInk.top)-1;
  const right=Math.max(cx+halfWidth,referenceInk.right+1,actualInk.right+1)+1,bottom=Math.max(cy+halfHeight,referenceInk.bottom+1,actualInk.bottom+1)+1;
  return{x:left,y:top,width:right-left,height:bottom-top};
}
