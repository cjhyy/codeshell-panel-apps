import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeTextRangePlan } from "../../../apps/design-studio/app/native-text-range-plan.mjs";
import { applyCreatedNativeTextRanges, preloadNativeTextRangeFonts } from "../../../apps/design-studio/app/figma-plugin/text-range-write.mjs";
import { captureBoundNativeTextRanges, finalizeCreatedNativeTextRanges } from "../../../apps/design-studio/app/figma-plugin/text-range-state.mjs";
import { restoreNativeTextRangeHint } from "../../../apps/design-studio/app/native-text-range-hint.mjs";
import { installNativeTextRangeSdkMock } from "./fixtures/native-text-sdk.mjs";
import { importFigmaJson, createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";

const mixed = Symbol("native-font-mixed"), copy = value => structuredClone(value);
function source() {
  const text = "A😀 BC";
  return { type:"text", text, textSource:text, textFlow:"wrap", fill:"#000000", textDecoration:"none",
    fontFamily:"Inter", fontSize:6, fontWeight:400, fontStyle:"normal", lineHeight:24, lineHeightUnit:"pixels", letterSpacing:0, textAlign:"left",
    textRanges:{ version:1, sourceSignature:JSON.stringify([text]), ranges:[
      { start:1, end:3, fontSize:4, fontWeight:700, fontStyle:"italic" },
      { start:4, end:5, fontFamily:"Arial", fontSize:18, fontWeight:600 },
    ] } };
}
function sdk(authored = source()) {
  const writes = [], hints = [];
  const target = { id:"font:1", type:"TEXT", characters:authored.textSource,
    fontName:{family:"Inter",style:"Regular"}, fontSize:authored.fontSize,
    fills:[{type:"SOLID",color:{r:0,g:0,b:0}}], textDecoration:"NONE",
    lineHeight:{unit:"PIXELS",value:24}, letterSpacing:{unit:"PIXELS",value:0},
    textAlignHorizontal:"LEFT", textAutoResize:"HEIGHT", textTruncation:"DISABLED", maxLines:null,
    layoutSizingHorizontal:"FILL", layoutSizingVertical:"HUG",
    setPluginData(key, value) { hints.push({key,value}); },
  };
  for (const method of ["setRangeFontName","setRangeFontSize","setRangeHyperlink","setRangeFills","setRangeTextDecoration"])
    target[method] = (...args) => writes.push([method,...copy(args)]);
  const native = installNativeTextRangeSdkMock(target,{mixed});
  target.exportAsync = async () => ({document:native.projectRest({id:target.id,type:"TEXT"})});
  return {target,source:authored,native,writes,hints};
}

test("native typography runs preserve UTF16 source positions, inherited gaps, mixed small sizes and faces", () => {
  const authored=source(), before=copy(authored), plan=nativeTextRangePlan(authored);
  assert.deepEqual(plan.runs.map(run=>[run.start,run.end,run.fontName,run.fontSize]),[
    [0,1,{family:"Inter",style:"Regular"},6], [1,3,{family:"Inter",style:"Bold Italic"},4],
    [3,4,{family:"Inter",style:"Regular"},6], [4,5,{family:"Arial",style:"Semi Bold"},18],
    [5,6,{family:"Inter",style:"Regular"},6],
  ]);
  assert.equal(plan.characters,authored.textSource);
  assert.deepEqual(authored,before);
  const legacy={...authored,textRanges:{...authored.textRanges,ranges:[{start:1,end:3,fill:"#ff0000"}]}};
  assert( nativeTextRangePlan(legacy).runs.every(run=>!Object.hasOwn(run,"fontName")&&!Object.hasOwn(run,"fontSize")) );
});

test("html2figma JSON typography survives canonical import and native transfer without splitting Text", () => {
  const raw={type:"TEXT",id:"json-text",name:"Mixed typography",x:0,y:0,width:180,height:40,
    characters:"A😀 BC",fontName:{family:"Inter",style:"Regular"},fontSize:6,
    lineHeight:{unit:"PIXELS",value:24},fills:[{type:"SOLID",color:{r:0,g:0,b:0}}],
    styledTextSegments:[{start:1,end:3,fontName:{family:"Inter",style:"Bold Italic"},fontSize:4},
      {start:4,end:5,fontName:{family:"Arial",style:"Semi Bold"},fontSize:18}]};
  const imported=importFigmaJson(raw);
  assert.equal(imported.document.nodes.length,1); assert.deepEqual(imported.warnings,[]);
  const transfer=createFigmaTransfer(imported.document), authored=transfer.pages[0].children[0], value=sdk(authored);
  applyCreatedNativeTextRanges(value.target,authored);
  assert.deepEqual(copy(value.target.getStyledTextSegments(["fontName","fontSize","fontWeight"])).map(run=>
    [run.start,run.end,run.fontName.style,run.fontSize,run.fontWeight]),[
    [0,1,"Regular",6,400],[1,3,"Bold Italic",4,700],[3,4,"Regular",6,400],
    [4,5,"Semi Bold",18,600],[5,6,"Regular",6,400],
  ]);
});

test("all native range faces preload once and unavailable exact fonts fail without fallback", async () => {
  const loaded=[], cache=new Map(), loader=async font=>loaded.push(copy(font));
  await preloadNativeTextRangeFonts(source(),loader,cache);
  await preloadNativeTextRangeFonts(source(),loader,cache);
  assert.deepEqual(loaded,[{family:"Inter",style:"Regular"},{family:"Inter",style:"Bold Italic"},{family:"Arial",style:"Semi Bold"}]);
  const attempts=[];
  await assert.rejects(preloadNativeTextRangeFonts(source(),async font=>{
    attempts.push(font); if(font.style==="Bold Italic")throw Error("missing");
  }),error=>error.code==="TEXT_RANGES_NATIVE_FONT_UNAVAILABLE"&&/Bold Italic/u.test(error.message));
  assert.equal(attempts.length,2);
  assert.equal(await preloadNativeTextRangeFonts({type:"text",text:"legacy"},null),undefined);
});

test("missing range font methods and setter failures cannot report successful native transfer", () => {
  const value=sdk(); delete value.target.setRangeFontSize;
  assert.throws(()=>applyCreatedNativeTextRanges(value.target,value.source),error=>error.code==="TEXT_RANGES_NATIVE_WRITE_UNAVAILABLE");
  assert.deepEqual(value.writes,[]);
  const failure=sdk(); failure.target.setRangeFontName=()=>{throw Error("native range font setter failed");};
  assert.throws(()=>applyCreatedNativeTextRanges(failure.target,failure.source),/native range font setter failed/u);
  assert.deepEqual(failure.writes,[]);
});

test("actual writer state and REST projection independently prove mixed faces/sizes before author metadata is saved", async () => {
  const value=sdk(), before=copy(value.source);
  applyCreatedNativeTextRanges(value.target,value.source);
  assert.equal(value.target.fontName,mixed); assert.equal(value.target.fontSize,mixed); assert.equal(value.target.fontWeight,mixed);
  const rest=(await value.target.exportAsync()).document;
  const captured=captureBoundNativeTextRanges(value.target,rest,mixed);
  assert.equal(captured.status,"bound",JSON.stringify(captured));
  await finalizeCreatedNativeTextRanges([value],{mixed,pluginId:"font-test",assertOwned:target=>assert.equal(target,value.target)});
  assert.equal(value.hints.length,1);
  const hint=JSON.parse(value.hints[0].value);
  assert.deepEqual(hint.fontBase,{fontFamily:"Inter",fontSize:6,fontWeight:400,fontStyle:"normal"});
  const restored=restoreNativeTextRangeHint({rest,source:captured.source,canonicalNode:value.source,hint,
    pluginId:"font-test",key:value.hints[0].key});
  assert.deepEqual(restored.textRanges,value.source.textRanges);
  assert.equal(restored.fontSize,6);
  assert.deepEqual(value.source,before);
  const changed=sdk(); applyCreatedNativeTextRanges(changed.target,changed.source);
  changed.target.setRangeFontSize(1,3,5);
  await assert.rejects(finalizeCreatedNativeTextRanges([changed],{mixed,pluginId:"font-test",assertOwned(){}}),
    error=>error.code==="NATIVE_TEXT_RANGE_HINT_EFFECTIVE");
  assert.deepEqual(changed.hints,[]);
});
