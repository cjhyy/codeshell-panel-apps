import assert from "node:assert/strict";
import { test } from "node:test";
import { geometryDifference, inkGeometry, largestConnectedCluster, strokeScan, symmetricPixelDifference, textGeometryFailures } from "./render-fidelity.metrics.mjs";
import { fidelityFontOmissions } from "./render-fidelity.fixture.mjs";
function image(dx = 0, dy = 0) {
  const width = 32, height = 32, data = new Uint8Array(width * height * 4).fill(255);
  for (let y = 8 + dy; y < 20 + dy; y++) for (let x = 8 + dx; x < 20 + dx; x++) {
    if (x > 11 + dx && y > 11 + dy) continue;
    const p = (y * width + x) * 4; data[p] = data[p + 1] = data[p + 2] = 0;
  }
  return { width, height, data };
}
test("self comparisons calibrate exactly zero and diagonal pixels are 8-connected", () => {
  assert.equal(symmetricPixelDifference(image(), image()).mismatchPixels, 0);
  assert.equal(symmetricPixelDifference(image(), image()).largestCluster, 0);
  assert.equal(largestConnectedCluster(Uint8Array.from([1,0,0,0,1,0,0,0,1]),3,3),3);
});
test("primary ink geometry catches a one-device-pixel shift tolerated by the 3x3 secondary metric", () => {
  const reference = image(), shifted = image(0,1), delta = geometryDifference(inkGeometry(reference), inkGeometry(shifted));
  assert.equal(delta.top,1); assert.equal(delta.bottom,1); assert(Math.abs(delta.centroidY - 1) < 1e-12);
  assert.equal(symmetricPixelDifference(reference,shifted).mismatchPixels,0);
  assert(textGeometryFailures(delta).some(failure => failure.startsWith("centroidY")));
});
test("two-device-pixel displacement fails both geometry and symmetric secondary gate", () => {
  const delta = geometryDifference(inkGeometry(image()),inkGeometry(image(2,2)));
  assert.equal(delta.top,2); assert.equal(delta.left,2); assert(textGeometryFailures(delta).length >= 3);
  const difference = symmetricPixelDifference(image(),image(2,2));
  assert(difference.mismatchRatio > .005); assert(difference.largestCluster > 6);
  assert.equal(difference.mismatchPixels,symmetricPixelDifference(image(2,2),image()).mismatchPixels);
});
test("coverage scans retain fractional stroke center and width information", () => {
  const a = strokeScan(image(),{x:14,y:8,halfWindow:3,average:3});
  const b = strokeScan(image(0,1),{x:14,y:8,halfWindow:3,average:3});
  assert.equal(a.width,4); assert.equal(b.width,3); assert(Math.abs(a.centroid-10)<1e-12); assert(Math.abs(b.centroid-10.5)<1e-12);
});
test("missing ink is an explicit unavailable measurement, never a zero delta", () => {
  const blank=image(); blank.data.fill(255);
  assert.equal(inkGeometry(blank),null); assert.deepEqual(textGeometryFailures(geometryDifference(inkGeometry(blank),inkGeometry(image()))),["ink not measurable"]);
});
test("multi-paint text uses the complete paint palette for bounds, not one run's antialiased fringe", () => {
  const sample=image();
  for(let i=0;i<sample.data.length;i+=4)if(sample.data[i]===0){sample.data[i]=204;sample.data[i+1]=34;sample.data[i+2]=51;}
  const measured=inkGeometry(sample,{foregrounds:[[0,0,0],[204,34,51],[34,68,170]]});
  assert.equal(measured.left,8);assert.equal(measured.right,19);assert.equal(measured.top,8);assert.equal(measured.bottom,19);
  assert.equal(inkGeometry(sample),null,"a different full-intensity paint must not masquerade as base black ink");
});
test("missing requested fonts are explicit fallback-only omissions, while unused fonts are not required", () => {
  const pages=[{id:"lines",nodes:[{id:"cjk",type:"text",fontFamily:'"PingFang SC", sans-serif'},{id:"latin",type:"text",fontFamily:"Arial"}]}];
  assert.deepEqual(fidelityFontOmissions([{family:"PingFang SC",available:false},{family:"Arial",available:true},{family:"Fidelity Inter",available:false}],pages),[{family:"PingFang SC",cases:[{page:"lines",id:"cjk"}],status:"fallback-only; requested font not certified"}]);
  assert.deepEqual(fidelityFontOmissions([{family:"PingFang SC",available:true},{family:"Arial",available:true}],pages),[]);
});

test("centroid threshold is mandatory for every text, including legacy opt-out callers and descenders", () => {
  const aligned={measurable:true,left:0,top:0,right:0,bottom:0,centroidX:0,centroidY:0};
  for(const text of ["HMI", "gypqj", "中文 gypqj", ""]){
    for(const centroidY of [-.8,.8]){
      const failures=textGeometryFailures({...aligned,centroidY},{text,centroid:false});
      assert.deepEqual(failures,[`centroidY ${centroidY} > 0.75`],"legacy callers cannot silently waive the shared centroid threshold");
    }
  }
  assert.deepEqual(textGeometryFailures({...aligned,centroidY:.75},{centroid:false}),[],"the existing inclusive threshold is unchanged");
});
