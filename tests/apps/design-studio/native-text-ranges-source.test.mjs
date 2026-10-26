import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { buildNativeTextRangeSource, validateNativeTextRangeSource, importNativeTextRanges,
  nativeTextRangeSnapshot, NATIVE_TEXT_RANGE_FIELDS, NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS,
  MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES } from "../../../apps/design-studio/app/native-text-ranges-source.mjs";
import { textRangeSourceSignature } from "../../../apps/design-studio/app/text-ranges.mjs";
const moduleUrl = new URL("../../../apps/design-studio/app/native-text-ranges-source.mjs", import.meta.url);
const fixture = JSON.parse(await readFile(new URL("../../fixtures/design-studio/native-text-ranges-630cc296.json", import.meta.url)));
const copy = value => structuredClone(value), val = value => ({ kind: "value", value });
// These sentinel strings belong only to the archived research protocol, not the production codec.
const archived = value => value === "FIGMA_MIXED" ? {kind:"mixed"} : value === "UNDEFINED" ? {kind:"missing"} : val(value);
const paint = (r = 0, g = 0, b = 0) => [{type:"SOLID",visible:true,opacity:1,blendMode:"NORMAL",color:{r,g,b},boundVariables:{}}];
function control(text = "Before AVfi\u0301\u00a0link\nafter.") {
  const node = {type:"text",text,textSource:text,fontFamily:"Inter",fontSize:24,fontWeight:400,fontStyle:"normal",
    lineHeight:30,lineHeightUnit:"pixels",letterSpacing:0,fill:"#000000",textDecoration:"none",textFlow:"wrap"};
  const entries = {fontName:{family:"Inter",style:"Regular",variationSettings:{wght:400,slnt:0}},fontSize:24,fontWeight:400,fontStyle:"REGULAR",
    lineHeight:{unit:"PIXELS",value:30},letterSpacing:{unit:"PERCENT",value:0},fills:paint(),textDecoration:"NONE",
    textDecorationStyle:null,textDecorationOffset:null,textDecorationThickness:null,textDecorationColor:null,textDecorationSkipInk:null,hyperlink:null,
    textCase:"ORIGINAL",openTypeFeatures:{},boundVariables:{},textStyleOverrides:[],textStyleId:"",fillStyleId:"",
    listOptions:{type:"NONE"},listSpacing:0,indentation:0,paragraphIndent:0,paragraphSpacing:0,textWrapStyle:"AUTO"};
  const values = Object.fromEntries(Object.entries(entries).map(([key,value]) => [key,val(value)]));
  const segments = [{start:0,end:7,characters:text.slice(0,7),values:copy(values)},
    {start:7,end:text.length,characters:text.slice(7),values:copy(values)}];
  segments[1].values.fills = val(paint(Math.fround(26/255), 77/255, 153/255));
  segments[1].values.hyperlink = val({type:"URL",value:"https://example.com/range"});
  const rest = {id:"1:2",type:"TEXT",characters:text,style:{fontFamily:"Inter",fontStyle:"Regular",fontSize:24,
    fontWeight:400,lineHeightUnit:"PIXELS",lineHeightPx:30},fills:paint(),
    characterStyleOverrides:Array.from(text, (_,i)=> i<7?0:1),styleOverrideTable:{1:{fills:copy(segments[1].values.fills.value),hyperlink:{type:"URL",url:"https://example.com/range"}}}};
  const scalars = Object.fromEntries(Object.entries(entries).map(([key,value]) => [key,val(value)]));
  for (const key of ["fills","hyperlink"]) scalars[key]={kind:"mixed"};
  Object.assign(scalars,{hasMissingFont:val(false),leadingTrim:val("NONE"),hangingPunctuation:val(false),hangingList:val(false),
    textAlignVertical:val("TOP"),textAlignHorizontal:val("LEFT"),textTruncation:val("DISABLED"),maxLines:val(null)});
  const input = {rest,characters:text,scalars,segments,rangeChecks:[{start:0,end:7,values:{hyperlink:val(1)}}]};
  return {node,input};
}
const codes = result => result.diagnostics.map(entry=>entry.code);
function built(controlValue = control()) {
  const result=buildNativeTextRangeSource(controlValue.input);assert.equal(result.status,"bound",JSON.stringify(result));
  return { ...controlValue, source:result.source };
}

test("actual630cc six live+REST sources retain Float32, units, raw observations and authored LF; custom geometry refuses all admission", () => {
  assert.equal(fixture.provenance.sourceSha256,"f32087334eb38b0b2ecebb09fc32af6f92730363e51bcac07d4e140c3828973c");
  assert.equal(fixture.cases.length,6);
  for (const entry of fixture.cases) {
    const {live,rest}=entry, before=JSON.stringify(entry);
    const values = object => Object.fromEntries(NATIVE_TEXT_RANGE_FIELDS.filter(key=>Object.hasOwn(object,key)).map(key=>[key,archived(object[key])]));
    const input={rest,characters:live.characters,scalars:values(live),segments:live.segments.map(s=>({start:s.start,end:s.end,characters:s.characters,values:values(s)})),
      rangeChecks:[{start:7,end:18,values:Object.fromEntries(Object.keys(live).filter(key=>key.startsWith("range_")).map(key=>[key.slice(6),archived(live[key])]))}]};
    const result=buildNativeTextRangeSource(input);
    assert.equal(result.status,"bound",`${entry.name}: ${JSON.stringify(result)}`);
    assert.deepEqual(result.source.segments,input.segments);
    assert.equal(result.source.characters.length,53);assert.equal(result.source.characters.split("\n").length,2);
    const imported=importNativeTextRanges({rest,source:result.source,canonicalNode:{type:"text",text:live.characters,fontSize:live.fontSize}});
    assert.equal(imported.status,"unsupported");assert.ok(codes(imported).includes("NATIVE_TEXT_RANGES_NATIVE_DECORATION_BASIS"));
    assert.equal(imported.textRanges,undefined);assert.equal(imported.pixelsVerified,false);
    assert.equal(JSON.stringify(entry),before);
    assert.deepEqual(validateNativeTextRangeSource(rest,JSON.parse(JSON.stringify(result.source))).source,result.source);
  }
});

test("strict exact native sRGB8 and source-first paint/link intent survives owned JSON and display wrapping", () => {
  const {input,node,source}=built(),before=JSON.stringify(input);
  node.text=node.text.replace("AV","A\nV"); // Source LF and real NBSP remain distinct from inserted display LF.
  const result=importNativeTextRanges({rest:input.rest,source,canonicalNode:node});
  assert.equal(result.status,"admitted-intent");assert.equal(result.pixelsVerified,false);
  assert.equal(result.textRanges.sourceSignature,textRangeSourceSignature(node.textSource));
  assert.equal(result.textRanges.ranges[0].fill,"#1a4d99");assert.equal(result.textRanges.ranges[0].href,"https://example.com/range");
  assert.ok(codes(result).includes("NATIVE_TEXT_RANGES_HYPERLINK_UNKNOWN"));
  assert.ok(codes(result).includes("NATIVE_TEXT_RANGES_PIXELS_UNVERIFIED"));
  assert.equal(JSON.stringify(input),before);
  result.textRanges.ranges[0].href="changed";assert.equal(source.segments[1].values.hyperlink.value.value,"https://example.com/range");
});

test("non8bit native channels, near8bit epsilons and alpha/bound/multiple/hidden paint refuse atomically without rounding", () => {
  for (const change of [
    p=>p[0].color.r=.1,p=>p[0].color.g=77/255+Number.EPSILON,p=>p[0].opacity=.5,p=>p[0].color.a=.99,
    p=>p[0].visible=false,p=>p[0].visible=1,p=>p[0].opacity=null,p=>p[0].blendMode=null,p=>p[0].color.a=null,p=>p[0].boundVariables=null,p=>p[0].futurePaintMode=true,p=>p.push(copy(p[0])),p=>p[0].type="GRADIENT_LINEAR",p=>p[0].boundVariables={color:{type:"VARIABLE_ALIAS",id:"x"}},
  ]) {
    const value=control();change(value.input.segments[1].values.fills.value);
    value.input.rest.styleOverrideTable[1].fills=copy(value.input.segments[1].values.fills.value);
    const {source}=built(value),before=JSON.stringify(source), result=importNativeTextRanges({rest:value.input.rest,source,canonicalNode:value.node});
    assert.equal(result.status,"unsupported");assert.equal(result.textRanges,undefined);assert.equal(JSON.stringify(source),before);
    assert.ok(codes(result).some(code=>["NATIVE_TEXT_RANGES_COLOR_QUANTIZATION","NATIVE_TEXT_RANGES_UNSUPPORTED_PAINT"].includes(code)));
  }
});

test("unknown numeric1/mixed/missing/error/null remain distinct and never override complete segment hyperlink evidence", () => {
  for (const observation of [val(1),{kind:"mixed"},{kind:"missing"},{kind:"error",message:"SDK unavailable"},val(null)]) {
    const value=control();value.input.rangeChecks[0].values.hyperlink=observation;
    const {source}=built(value);assert.deepEqual(source.rangeChecks[0].values.hyperlink,observation);
    const result=importNativeTextRanges({rest:value.input.rest,source,canonicalNode:value.node});
    assert.equal(result.status,"admitted-intent");
    assert.equal(result.textRanges.ranges[0].href,"https://example.com/range");
  }
  const value=control();value.input.rangeChecks[0].values.hyperlink=val({type:"URL",value:"https://different.test"});
  assert.ok(codes(buildNativeTextRangeSource(value.input)).includes("NATIVE_TEXT_RANGES_CAPTURE_RACE"));
});

test("REST signature is presence-aware, pluginData is never authority, and changed omitted-live properties change the native snapshot", () => {
  const {input,source}=built();
  assert.equal(validateNativeTextRangeSource({...input.rest,characters:input.rest.characters+"x"},source).status,"stale");
  assert.equal(validateNativeTextRangeSource({...input.rest,style:{...input.rest.style,textDecoration:null}},source).status,"stale");
  const other=copy(source);other.segments[1].values.textDecorationOffset=val({unit:"PERCENT",value:15.779999732971191});
  assert.notEqual(nativeTextRangeSnapshot(source),nativeTextRangeSnapshot(other));
  assert.equal(validateNativeTextRangeSource(input.rest,other).status,"bound"); // REST omission cannot erase the live property.
  assert.equal(importNativeTextRanges({rest:input.rest,source:other,canonicalNode:control().node}).status,"unsupported");
  const spoof={...input.rest,pluginData:{codeshellNativeTextRanges:source}};
  assert.equal(validateNativeTextRangeSource(spoof).status,"absent");
  assert.equal(validateNativeTextRangeSource({...input.rest,codeshellNativeTextRanges:source}).status,"bound");
  const renumbered=copy(input.rest);renumbered.styleOverrideTable={9:renumbered.styleOverrideTable[1]};renumbered.characterStyleOverrides=renumbered.characterStyleOverrides.map(x=>x?9:0);
  const next=buildNativeTextRangeSource({...input,rest:renumbered});assert.equal(next.status,"bound");
  assert.equal(nativeTextRangeSnapshot(next.source),nativeTextRangeSnapshot(source));
});

test("known live scalar/getter/REST contradictions and malformed REST override references reject capture rather than invent defaults", () => {
  for (const mutate of [
    x=>x.scalars.fontSize=val(99),x=>x.rest.style.fontSize=99,
    x=>x.rest.styleOverrideTable[1].hyperlink.url="https://different.test",x=>x.rest.characterStyleOverrides[1]=99,
    x=>x.rest.characterStyleOverrides.push(0),x=>x.rangeChecks[0].values.textDecoration=val("UNDERLINE"),
    x=>x.segments[1].values.fills.value[0].color.b=0,
  ]) {const {input}=control();mutate(input);assert.notEqual(buildNativeTextRangeSource(input).status,"bound");}
  const value=control();value.input.rest.characterStyleOverrides=value.input.rest.characterStyleOverrides.slice(0,7);
  delete value.input.rest.styleOverrideTable[1];delete value.input.rest.styleOverrideTable;
  value.input.segments[1].values=copy(value.input.segments[0].values);value.input.scalars.hyperlink=val(null);value.input.scalars.fills=val(paint());
  assert.equal(buildNativeTextRangeSource(value.input).status,"bound"); // Official trailing0 default semantics.
});

test("uniform metric and shaping/context changes are source-preserved but whole canonical range admission refuses", () => {
  for (const change of [
    x=>x.segments[1].values.fontName.value.variationSettings.wght=500,
    x=>x.segments[1].values.fontName.value.variationSettings=null,
    x=>x.segments[1].values.listOptions=val({type:"ORDERED"}),x=>x.segments[1].values.paragraphSpacing=val(10),
    x=>x.segments[1].values.openTypeFeatures=val({LIGA:false}),x=>x.segments[1].values.openTypeFeatures=val(1),
    x=>x.segments[1].values.textStyleOverrides=val([{type:"SEMANTIC_WEIGHT"}]),x=>x.segments[1].values.textWrapStyle=val("BALANCE"),
    x=>x.scalars.hasMissingFont=val(true),x=>delete x.scalars.hasMissingFont,x=>x.scalars.leadingTrim=val("CAP_HEIGHT"),
    x=>x.scalars.maxLines=val(1),x=>x.scalars.textTruncation=val("ENDING"),x=>x.scalars.hangingPunctuation=val(true),
  ]) {
    const value=control();change(value.input);
    const result=buildNativeTextRangeSource(value.input);assert.equal(result.status,"bound",JSON.stringify(result));
    const imported=importNativeTextRanges({rest:value.input.rest,source:result.source,canonicalNode:value.node});
    assert.equal(imported.status,"unsupported");assert.equal(imported.textRanges,undefined);
  }
});

test("native custom decoration, unsupported URL and unresolved native target never partially admit color/link ranges", () => {
  for (const change of [
    x=>x.textDecorationOffset=val({unit:"PERCENT",value:15.779999732971191}),x=>x.textDecorationThickness=val({unit:"PIXELS",value:1}),
    x=>x.textDecorationColor=val({value:"AUTO"}),x=>x.textDecorationSkipInk=val(true),x=>x.textDecorationOffset=val({unit:"AUTO"}),
    x=>x.hyperlink=val({type:"URL",value:"#"}),x=>x.hyperlink=val({type:"NODE",value:"1:99"}),x=>x.hyperlink=val(1),
  ]) {
    const value=control();change(value.input.segments[1].values);delete value.input.rest.styleOverrideTable[1].hyperlink;
    const {source}=built(value);const imported=importNativeTextRanges({rest:value.input.rest,source,canonicalNode:value.node});
    assert.equal(imported.status,"unsupported");assert.equal(imported.textRanges,undefined);
  }
});

test("complete UTF16 ownership, segment budgets, ranges, source signatures and display omissions are validated", () => {
  for (const change of [
    x=>x.segments[1].start++,x=>x.segments[1].end--,x=>x.segments.reverse(),x=>x.segments[1].characters+="x",
    x=>x.segments[0].values.hyperlink={kind:"value"},x=>x.segments[0].values.unknown=val(1),
    x=>x.segments=Array(1),x=>x.rangeChecks=Array(257).fill(x.rangeChecks[0]),x=>x.rangeChecks[0].end=500,
    x=>x.characters+="x",x=>x.scalars.hyperlink={kind:"mixed",value:null},x=>x.characters="x".repeat(4001),
  ]) { const {input}=control();change(input);assert.notEqual(buildNativeTextRangeSource(input).status,"bound"); }
  const {input,node,source}=built();node.textSource="wrong";assert.equal(importNativeTextRanges({rest:input.rest,source,canonicalNode:node}).status,"unsupported");
  node.textSource=input.characters;node.text=node.text.slice(1);assert.equal(importNativeTextRanges({rest:input.rest,source,canonicalNode:node}).status,"unsupported");
  const emoji=control("Before \u{1f600} after");emoji.input.rest.characterStyleOverrides=Array(emoji.node.text.length).fill(0);emoji.input.rest.styleOverrideTable={};
  emoji.input.segments[1].values=copy(emoji.input.segments[0].values);emoji.input.segments[0].end=8;emoji.input.segments[0].characters=emoji.node.text.slice(0,8);
  emoji.input.segments[1].start=8;emoji.input.segments[1].characters=emoji.node.text.slice(8);assert.notEqual(buildNativeTextRangeSource(emoji.input).status,"bound");
});

test("bounded JSON cloning rejects cycles/accessors/prototypes/overcap atomically and preserves unknown unit payload exactly", () => {
  for (const change of [
    x=>x.scalars.hyperlink=val({x:"x".repeat(MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES)}),
    x=>{let v={};x.scalars.hyperlink=val(v);for(let i=0;i<13;i++)v=v.next={};},
    x=>{const v={};v.self=v;x.scalars.hyperlink=val(v);},x=>x.scalars.hyperlink=val(new Date()),
    x=>Object.defineProperty(x.segments[1].values,"fills",{get(){throw Error("getter invoked")},enumerable:true}),
    x=>x.scalars.hyperlink=val(NaN),x=>x.segments=Array(257).fill(x.segments[0]),
  ]) {const {input}=control();change(input);assert.notEqual(buildNativeTextRangeSource(input).status,"bound");}
  const value=control();value.input.segments[1].values.textDecorationOffset=val({unit:"FUTURE_NATIVE_UNIT",value:15.779999732971191,unknown:{enabled:true}});
  const {source}=built(value);assert.deepEqual(source.segments[1].values.textDecorationOffset,value.input.segments[1].values.textDecorationOffset);
  assert.equal(importNativeTextRanges({rest:value.input.rest,source,canonicalNode:value.node}).status,"unsupported");
});

test("portable pure helper uses no TextEncoder/URL/structuredClone and fixed field lists never request scalar-only keys as segments", async () => {
  assert.ok(NATIVE_TEXT_RANGE_FIELDS.includes("textWrapStyle"));assert.ok(NATIVE_TEXT_RANGE_FIELDS.includes("boundVariables"));
  assert.ok(NATIVE_TEXT_RANGE_SCALAR_ONLY_FIELDS.includes("hasMissingFont"));
  assert.ok(!NATIVE_TEXT_RANGE_FIELDS.includes("hasMissingFont"));assert.ok(!NATIVE_TEXT_RANGE_FIELDS.includes("variationSettings"));
  const module=(await readFile(moduleUrl,"utf8")).replace(/^import .*;$/gm, "").replaceAll(/^export /gm, "");
  const family=(await readFile(new URL("../../../apps/design-studio/app/font-family.mjs", import.meta.url),"utf8")).replaceAll(/^export /gm, "");
  const core=(await readFile(new URL("../../../apps/design-studio/app/text-ranges.mjs", import.meta.url),"utf8")).replace(/^import .*;$/gm, "").replaceAll(/^export /gm, "");
  const line=(await readFile(new URL("../../../apps/design-studio/app/text-line-height.mjs", import.meta.url),"utf8")).replaceAll(/^export /gm, "");
  const context=vm.createContext({});
  vm.runInContext(`Object.assign(this,(()=>{${family};return {parseDesignFontFamily};})());`,context);
  vm.runInContext(`Object.assign(this,(()=>{${core};return {textRangeSourceSignature,validateTextRanges,isSafeTextRangeHref};})());`,context);
  vm.runInContext(`Object.assign(this,(()=>{${line};return {nativeTextLineHeight,validTextLineHeight};})());`,context);
  vm.runInContext(module+"\nthis.api={buildNativeTextRangeSource,validateNativeTextRangeSource,nativeTextRangeSnapshot,importNativeTextRanges};",context);
  context.inputJson=JSON.stringify(control().input);context.nodeJson=JSON.stringify(control().node);
  const result=vm.runInContext("api.buildNativeTextRangeSource(JSON.parse(inputJson))",context);
  assert.equal(result.status,"bound");
  assert.equal(vm.runInContext("api.importNativeTextRanges({rest:JSON.parse(inputJson).rest,source:api.buildNativeTextRangeSource(JSON.parse(inputJson)).source,canonicalNode:JSON.parse(nodeJson)}).status",context),"admitted-intent");
  assert.equal(vm.runInContext("typeof TextEncoder+'/'+typeof URL+'/'+typeof structuredClone",context),"undefined/undefined/undefined");
  assert.equal(vm.runInContext("api.nativeTextRangeSnapshot(api.buildNativeTextRangeSource(JSON.parse(inputJson)).source)",context),nativeTextRangeSnapshot(built().source));
});


test("all256 native byte channel representations admit exactly; non-null typed decorations and primitive spoof values never infer defaults", () => {
  for (let byte=0;byte<256;byte++) {
    const value=control("Before ABC");
    value.input.segments[1].values.fills=val(paint(byte/255,Math.fround(byte/255),byte/255));
    value.input.rest.styleOverrideTable[1].fills=copy(value.input.segments[1].values.fills.value);
    const {source}=built(value), result=importNativeTextRanges({rest:value.input.rest,source,canonicalNode:value.node});
    assert.equal(result.status,"admitted-intent");
    assert.equal(result.textRanges.ranges[0].fill ?? value.node.fill,`#${byte.toString(16).padStart(2,"0").repeat(3)}`);
  }
  for (const [key, value] of [["textDecorationSkipInk",false],["textDecorationStyle","SOLID"],["textDecorationColor",{value:"AUTO"}]]) {
    const x=control();x.input.segments[1].values[key]=val(value);const {source}=built(x);
    assert.ok(codes(importNativeTextRanges({rest:x.input.rest,source,canonicalNode:x.node})).includes("NATIVE_TEXT_RANGES_NATIVE_DECORATION_BASIS"));
  }
});

test("source budget is actualUTF8 and complete rejection precedes activation, while prototype-key data stays inert", () => {
  const value=control();value.input.scalars.hyperlink=val(JSON.parse('{"__proto__":{"polluted":true},"constructor":"unchanged"}'));
  const {source}=built(value);assert.equal({}.polluted,undefined);
  assert.equal(Object.hasOwn(source.scalars.hyperlink.value,"__proto__"),true);
  assert.equal(validateNativeTextRangeSource(value.input.rest,source).status,"bound");
  const huge=control();huge.input.scalars.hyperlink=val("é".repeat(MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES/2));
  const before=JSON.stringify(huge.input),result=buildNativeTextRangeSource(huge.input);
  assert.equal(result.source,undefined);assert.ok(codes(result).includes("NATIVE_TEXT_RANGES_BUDGET"));assert.equal(JSON.stringify(huge.input),before);
});

test("peer controls catch known scalar hyperlink and REST/live variable binding conflicts; large raw arrays reject without quadratic index scans", () => {
  for (const link of [{type:"URL",value:"https://wrong.test"},null]) {
    const value=control();value.input.scalars.hyperlink=val(link);
    const result=buildNativeTextRangeSource(value.input);
    assert.ok(codes(result).includes("NATIVE_TEXT_RANGES_CAPTURE_RACE"));
  }
  const bound=control();bound.input.rest.styleOverrideTable[1].fills[0].boundVariables={color:{type:"VARIABLE_ALIAS",id:"wrong"}};
  assert.ok(codes(buildNativeTextRangeSource(bound.input)).includes("NATIVE_TEXT_RANGES_CAPTURE_RACE"));
  const huge=control();huge.input.scalars.hyperlink=val(Array(131073).fill(0));
  assert.ok(codes(buildNativeTextRangeSource(huge.input)).includes("NATIVE_TEXT_RANGES_BUDGET"));
});

test("API arguments, REST identity and default source metadata accessors never execute", () => {
  let invoked=0;
  const getter={enumerable:true,get(){invoked++;return "forbidden"}};
  const good=built();
  const bad={};Object.defineProperty(bad,"rest",getter);
  assert.equal(buildNativeTextRangeSource(bad).status,"invalid");
  assert.equal(importNativeTextRanges(bad).status,"unsupported");
  for (const field of ["id","type","characters","style"]) {
    const value=control();Object.defineProperty(value.input.rest,field,getter);
    assert.equal(buildNativeTextRangeSource(value.input).status,"invalid");
    assert.equal(validateNativeTextRangeSource(value.input.rest,good.source).status,"invalid");
  }
  const rest=copy(good.input.rest);Object.defineProperty(rest,"codeshellNativeTextRanges",getter);
  assert.equal(validateNativeTextRangeSource(rest).status,"invalid");assert.equal(invoked,0);
});

test("known REST/live alignment, weight, spacing and percentage line-height applicability cannot claim a coherent capture", () => {
  for (const change of [
    x=>{x.rest.style.textAlignHorizontal="LEFT";x.scalars.textAlignHorizontal=val("CENTER")},
    x=>{x.rest.style.textAlignVertical="TOP";x.scalars.textAlignVertical=val("CENTER")},
    x=>x.rest.style.fontWeight=700,x=>x.rest.style.letterSpacing=5,
    x=>{x.rest.style.lineHeightUnit="FONT_SIZE_%";x.rest.style.lineHeightPercentFontSize=200},
    x=>{x.rest.style.textAutoResize="HEIGHT";x.scalars.textAutoResize=val("NONE")},
  ]) {const {input}=control();change(input);assert.ok(codes(buildNativeTextRangeSource(input)).includes("NATIVE_TEXT_RANGES_CAPTURE_RACE"));}
});


test("ordinary native uniform Text does not acquire a range payload or the staged native-range refusal", () => {
  const x=control();x.input.segments[1].values=copy(x.input.segments[0].values);
  delete x.input.rest.characterStyleOverrides;delete x.input.rest.styleOverrideTable;
  x.input.scalars.fills=val(paint());x.input.scalars.hyperlink=val(null);
  const {source}=built(x), result=importNativeTextRanges({rest:x.input.rest,source,canonicalNode:x.node});
  assert.equal(result.status,"uniform");assert.equal(result.textRanges,undefined);
  assert.equal(result.pixelsVerified,false);
});
