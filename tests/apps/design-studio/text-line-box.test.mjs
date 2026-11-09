import assert from "node:assert/strict";
import { test } from "node:test";
import { textHasLineBoxOrigin, textLineBoxAlphabeticOffset, textLineBoxBaselineY, textFiniteBaselineY, textSvgLineBox } from "../../../apps/design-studio/app/text-line-box.mjs";
import { canvasKitTextFontVariations } from "../../../apps/design-studio/app/canvas/canvaskit-text.mjs";
import { textRangeSourceSignature } from "../../../apps/design-studio/app/text-ranges.mjs";
import { textMetricsSignature, currentTextMetrics, measuredTextInkBounds } from "../../../apps/design-studio/app/text-metrics.mjs";
import { normalizeDesignDocument, exportDesignSvg, designPageBounds } from "../../../apps/design-studio/app/document.mjs";

const node = { id: "copy", name: "Copy", stroke:"transparent", strokeWidth:0, opacity:1, rotation:0, cornerRadius:0, visible:true, locked:false, type: "text", x: 12, y: 20.25, width: 180, height: 100, text: "Hgx\nSecond", fontFamily: "Arial", fontSize: 20, fontWeight: 400, lineHeight: 1.6, textAlign: "left", fill: "#000000" };
const documentFor = value => normalizeDesignDocument({ format: "codeshell.design", version: 3, name: "Line box", canvas: {width:300,height:200,background:"#ffffff"}, tokens:{colors:[]},activePageId:"main",pages:[{id:"main",name:"Main",children:[value]}] });

test("line-box font metrics distribute leading without changing authored coordinates", () => {
  const before = structuredClone(node);
  assert.equal(textLineBoxAlphabeticOffset(node, {ascent:19,descent:5}),23);
  assert.equal(textLineBoxAlphabeticOffset({...node,lineHeight:1},{ascent:19,descent:5}),17);
  assert.equal(textLineBoxAlphabeticOffset({...node,lineHeight:43,lineHeightUnit:"pixels"},{ascent:19,descent:5}),28);
  assert.deepEqual(textSvgLineBox(node,1,{ascent:19,descent:5}),{y:75,baseline:"alphabetic"});
  assert.throws(()=>textLineBoxAlphabeticOffset(node,{ascent:NaN,descent:0}),/finite/);
  assert.deepEqual(node,before);
});

test("every finite imported offset keeps its original hanging origin including zero", () => {
  for(const offset of [-12,0,3.25]){
    const imported={...node,layoutBaselineOffset:offset};
    assert.equal(textHasLineBoxOrigin(imported),false);
    assert.deepEqual(textSvgLineBox(imported,1,{ascent:19,descent:5}),{y:52.25,baseline:"hanging"});
    assert(!textMetricsSignature(imported).includes("line-box-v1"));
  }
});

test("measured finite paint transports exact hanging geometry through CSS LayoutUnits", () => {
  const metrics = { ascent: 12, descent: 3, hangingToAlphabetic: 9.6 };
  for (const offset of [-12, 0, 3.25]) {
    const imported = { ...node, y: 20.499, fontSize: 13, lineHeight: 1.6, layoutBaselineOffset: offset };
    const before = structuredClone(imported);
    assert.equal(textFiniteBaselineY(imported, 0, metrics), 30);
    assert.equal(textFiniteBaselineY(imported, 5, metrics), 134, "leading accumulates as 20.796875 CSS px");
    assert.equal(textFiniteBaselineY({ ...imported, y: 0 }, 5, metrics, { originY: imported.y }), 113.501);
    assert.deepEqual(textSvgLineBox(imported, 0, metrics), { y: 30, baseline: "alphabetic" });
    assert.deepEqual(imported, before);
  }
  assert.throws(() => textFiniteBaselineY(node, 0, { ascent: 12, descent: 3 }), /measured hanging/);
});

test("origin signature invalidates old hanging receipts without changing finite receipts", () => {
  const oldSignature=JSON.stringify([node.text,node.fontFamily,"",20,400,"normal",0,1.6]);
  const textMetrics={version:1,signature:oldSignature,lineWidths:[50,70],lineInkBounds:[{x:0,y:2,width:50,height:18},{x:0,y:2,width:70,height:18}],height:52,fontAvailable:true};
  assert.equal(currentTextMetrics({...node,textMetrics}),null);
  assert.equal(currentTextMetrics({...node,layoutBaselineOffset:0,textMetrics}),textMetrics);
  const current={...node,textMetrics:{...textMetrics,signature:textMetricsSignature(node),alphabeticBaseline:23}};
  assert.deepEqual(measuredTextInkBounds(current),{x:0,y:1.75,width:70,height:50});
});

test("offline SVG accepts explicit metrics and marks unmeasured fallback rather than certifying it", () => {
  const design=documentFor(node),diagnostics=[];
  const fallback=exportDesignSvg(design,{diagnostics});
  assert.match(fallback,/data-text-line-box="unmeasured"/);
  assert.deepEqual(diagnostics,[{code:"TEXT_LINE_BOX_SVG_UNMEASURED",nodeId:"copy"}]);
  const exact=exportDesignSvg(design,{textLineBoxMetrics:new Map([["copy",{ascent:19,descent:5}]])});
  assert.match(exact,/y="43"[^>]*dominant-baseline="alphabetic"/);
  assert(!exact.includes("unmeasured"));
});

test("paint baselines follow measured Blink CSS origin and multiline layout quantization", () => {
  const probe={...node,y:20.5,fontSize:13,lineHeight:1.6};
  assert.equal(textLineBoxBaselineY(probe,0,15),36);
  assert.equal(textLineBoxBaselineY(probe,5,15),139,"20.8px line-height accumulates as 20.796875 CSS px");
  assert.equal(textLineBoxBaselineY({...probe,y:20.499},0,15),35,"layout top truncation must precede paint rounding");
  assert.equal(textLineBoxBaselineY({...probe,y:0},5,15,{originY:20.5}),118.5,"local pictures retain the original world phase");
  for(const layoutBaselineOffset of [-12,0,3.25])
    assert.equal(textLineBoxBaselineY({...probe,layoutBaselineOffset},5,7),131.5,"finite offsets retain their raw line step and origin");
  assert.equal(probe.y,20.5);
});

test("derived ink bounds include snapped multiline paint without mutating logical receipts or finite offsets", () => {
  const probe = {...node,y:20.5,fontSize:13,lineHeight:1.6,text:Array(6).fill("HMI").join("\n")};
  const receipt = value => ({...value,textMetrics:{version:1,signature:textMetricsSignature(value),
    lineWidths:Array(6).fill(20),lineInkBounds:Array.from({length:6},()=>({x:0,y:2,width:20,height:10})),
    alphabeticBaseline:15,height:124.8,fontAvailable:true}});
  const painted = receipt(probe), before = JSON.stringify(painted);
  assert.deepEqual(measuredTextInkBounds(painted),{x:0,y:2.5,width:20,height:113});
  assert.equal(JSON.stringify(painted),before,"paint geometry must not rewrite measurement receipts");
  assert.deepEqual(measuredTextInkBounds(receipt({...probe,layoutBaselineOffset:0})),{x:0,y:2,width:20,height:114});
});


test("unmeasured infinite text bounds retain large pixel leading and preserve imported bounds", () => {
  const large = {...node,text:"Hg",fontSize:10,lineHeight:200,lineHeightUnit:"pixels",height:10};
  const design = documentFor(large); design.canvas.mode = "infinite";
  const bounds = designPageBounds(design);
  assert(bounds.y + bounds.height >= large.y + 100, "line-box ink is below the authored short box");
  const imported = documentFor({...large,layoutBaselineOffset:0}); imported.canvas.mode = "infinite";
  const oldBounds = designPageBounds(imported);
  assert(oldBounds.y + oldBounds.height < large.y + 100, "finite offsets keep the historical hanging extent");
});


test("native optical sizing uses only verified axes and never changes finite or mixed typography instances", () => {
  const capabilities={status:"verified",axes:[{tag:"wght",min:100,max:900,default:400},{tag:"opsz",min:14,max:32,default:14}]};
  const style={...node,fontWeight:600};
  for(const [fontSize,value] of [[10,14],[20,20],[60,32]])
    assert.deepEqual(canvasKitTextFontVariations(node,{...style,fontSize},capabilities),[{axis:"wght",value:600},{axis:"opsz",value}]);
  for(const layoutBaselineOffset of [-3,0,5.25])
    assert.deepEqual(canvasKitTextFontVariations({...node,layoutBaselineOffset},style,capabilities),[{axis:"wght",value:600}]);
  const mixed={...node,textRanges:{version:1,sourceSignature:textRangeSourceSignature(node.text),ranges:[{start:0,end:3,fontSize:18}]}};
  assert.deepEqual(canvasKitTextFontVariations(mixed,style,capabilities),[{axis:"wght",value:600}]);
  assert.deepEqual(canvasKitTextFontVariations(node,style,{...capabilities,status:"unsupported"}),[]);
});

/* Cross-surface batch (LH). The LayoutUnit of a line height follows the CSS form HTML export writes: a unitless
 * multiplier is truncated, a px length rounded (Chromium 148, s1 and s2: 24/24 distinguishing pairs each way). 14/1.3 =
 * 18.2px = 1164.8/64: trunc 18.1875 vs round 18.203125; at y 350.3 the second line paints at 380 instead of 381. */
test("ratio line heights accumulate as truncated LayoutUnits, pixel line heights as rounded ones", async () => {
  const { textLineBoxBaselineAt } = await import("../../../apps/design-studio/app/text-line-box.mjs");
  const p = { ...node, y: 350.3, fontSize: 14, lineHeight: 1.3 };
  assert.equal(textLineBoxBaselineY(p, 0, 12), 362);
  assert.equal(textLineBoxBaselineY(p, 1, 12), 380, "350.296875 + 18.1875 + 12 = 380.48 -> 380 (round LH: 380.5 -> 381)");
  assert.equal(textLineBoxBaselineY(p, 1, 12, { layoutScale: 2 }), 380.5, "s2: 700.59375 + 36.390625 + 24 -> 761 / 2 (unchanged)");
  assert.equal(textLineBoxBaselineY({ ...p, fontSize: 16, lineHeight: 1.35 }, 3, 15), 430, "21.6 = 1382.4/64: round = trunc (control)");
  // Finite transport steps by the same truncated line height.
  assert.equal(textFiniteBaselineY({ ...p, layoutBaselineOffset: 0 }, 1, { ascent: 13, descent: 3, hangingToAlphabetic: 9.75 }), 378,
    "trunc(350.3 + 9.75 - 13) + 18.1875 + 13 = 378.48 -> 378 (round LH: 378.5 -> 379)");
  // Mixed sizes without a receipt: each line's height truncated, then summed (not the truncated sum).
  assert.equal(textLineBoxBaselineAt(p, 23.4 + 18.2, 12, { precedingLineHeights: [23.4, 18.2] }),
    Math.round(350.296875 + (Math.floor(23.4 * 64) + Math.floor(18.2 * 64)) / 64 + 12));
  // A px line height keeps the rounded LayoutUnit (DOM oracle: 13.2px steps 13.203125).
  const px = { ...p, lineHeight: 13.2, lineHeightUnit: "pixels" };
  assert.equal(textLineBoxBaselineY({ ...px, y: 20.499 }, 5, 11), 98, "trunc(20.499) + 5 x 13.203125 + 11 = 97.5 -> 98 (trunc LH: 97.43 -> 97)");
  // Half-leading uses the float line height: with integer (rounded) ascent/descent, floor((lh + A - D) / 2) equals
  // floor((trunc64(lh) + A - D) / 2) for every lh (an even integer is crossed by lh iff by its 1/64 truncation).
  for (let size = 8; size <= 40; size += 0.5) for (let ratio = 1; ratio <= 2.001; ratio += 0.05) for (const k of [-9, 0, 7, 10])
    assert.equal(Math.floor((size * ratio + k) / 2), Math.floor((Math.floor(size * ratio * 64 + 1e-7) / 64 + k) / 2), `${size}/${ratio}/${k}`);
});
