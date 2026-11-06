import assert from "node:assert/strict";
import { test } from "node:test";
import { textHasLineBoxOrigin, textLineBoxAlphabeticOffset, textSvgLineBox } from "../../../apps/design-studio/app/text-line-box.mjs";
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
  assert.deepEqual(textSvgLineBox(node,1,{ascent:19,descent:5}),{y:75.25,baseline:"alphabetic"});
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

test("origin signature invalidates old hanging receipts without changing finite receipts", () => {
  const oldSignature=JSON.stringify([node.text,node.fontFamily,"",20,400,"normal",0,1.6]);
  const textMetrics={version:1,signature:oldSignature,lineWidths:[50,70],lineInkBounds:[{x:0,y:2,width:50,height:18},{x:0,y:2,width:70,height:18}],height:52,fontAvailable:true};
  assert.equal(currentTextMetrics({...node,textMetrics}),null);
  assert.equal(currentTextMetrics({...node,layoutBaselineOffset:0,textMetrics}),textMetrics);
  const current={...node,textMetrics:{...textMetrics,signature:textMetricsSignature(node),alphabeticBaseline:23}};
  assert.deepEqual(measuredTextInkBounds(current),{x:0,y:2,width:70,height:50});
});

test("offline SVG accepts explicit metrics and marks unmeasured fallback rather than certifying it", () => {
  const design=documentFor(node),diagnostics=[];
  const fallback=exportDesignSvg(design,{diagnostics});
  assert.match(fallback,/data-text-line-box="unmeasured"/);
  assert.deepEqual(diagnostics,[{code:"TEXT_LINE_BOX_SVG_UNMEASURED",nodeId:"copy"}]);
  const exact=exportDesignSvg(design,{textLineBoxMetrics:new Map([["copy",{ascent:19,descent:5}]])});
  assert.match(exact,/y="43.25"[^>]*dominant-baseline="alphabetic"/);
  assert(!exact.includes("unmeasured"));
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
