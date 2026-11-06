import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inkGeometry} from './render-fidelity.metrics.mjs';
import {rotationGeometry,compareRotationGeometry} from './render-fidelity-geometry.mjs';
import {rotationMomentRoi} from './rotation-moment-roi.mjs';
const foreground=[155,78,46],background=[255,255,255],node={x:43,y:49,width:14,height:2,rotation:40},originalRoi={x:28,y:32,width:44,height:36};
function image(dx=0){const width=100,height=100,data=new Uint8Array(width*height*4).fill(255),angle=40*Math.PI/180;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){let hits=0;for(let j=0;j<8;j++)for(let i=0;i<8;i++){const px=x+(i+.5)/8-50-dx,py=y+(j+.5)/8-50;hits+=Math.abs(px*Math.cos(angle)+py*Math.sin(angle))<7&&Math.abs(-px*Math.sin(angle)+py*Math.cos(angle))<1;}const alpha=hits/64;for(let c=0;c<3;c++)data[(y*width+x)*4+c]=Math.round(255+alpha*(foreground[c]-255));if(x>=28&&x<31)for(let c=0;c<3;c++)data[(y*width+x)*4+c]=[245,246,243][c];}return{width,height,data};}
function options(reference,actual){const wide={roi:originalRoi,foreground,background},referenceInk=inkGeometry(reference,wide),actualInk=inkGeometry(actual,wide);return{foreground,background,localLongEdgeCss:14,scale:1,roi:rotationMomentRoi({node,tile:{x:0,y:0},scale:1,originalRoi,referenceInk,actualInk})};}
test('isolated own-fill moments exclude an outer ancestor background strip admitted by wide color projection',()=>{const reference=image(),wide=rotationGeometry(reference,{roi:originalRoi,foreground,background});assert.ok(Math.abs(wide.angleDegrees-40)>5);const bounded=rotationGeometry(reference,options(reference,reference));assert.ok(Math.abs(bounded.angleDegrees-40)<.5,JSON.stringify({wide,bounded}));});
test('moment region encloses observed displaced ink and retains a real two-pixel defect',()=>{const reference=image(),actual=image(2),bounded=compareRotationGeometry(reference,actual,options(reference,actual));assert.ok(bounded.centroid>1.9&&bounded.centroid<2.1,JSON.stringify(bounded));assert.ok(bounded.failures.some(x=>x.startsWith('rotation centroid')));});
