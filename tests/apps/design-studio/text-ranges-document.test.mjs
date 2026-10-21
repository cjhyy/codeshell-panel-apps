import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { normalizeDesignDocument, serializeDesignDocument, exportDesignSvg } from "../../../apps/design-studio/app/document.mjs";
import { textRangeSourceSignature, validateTextRanges, replaceTextRange, validateTextRangeNodePatch } from "../../../apps/design-studio/app/text-ranges.mjs";
import { nativeTextContent } from "../../../apps/design-studio/app/text-content.mjs";
import { measuredWrap, measuredWrapSource } from "../../../apps/design-studio/app/text-metrics.mjs";
import { applyAutoLayouts } from "../../../apps/design-studio/app/layout.mjs";
import { createPortableDesign, planPortableDesign } from "../../../apps/design-studio/app/portable-backup.mjs";
import { plainFixture } from "./fixtures/figma-plugin-v3.mjs";
const raw = () => {
  const value=plainFixture(), text=value.pages[0].children[0].children[0];
  Object.assign(text,{text:"Alpha link.\nBlank\n\nSpace \u00a0",textSource:"Alpha link.\nBlank\n\nSpace \u00a0",textFlow:"wrap",textRanges:{version:1,sourceSignature:textRangeSourceSignature("Alpha link.\nBlank\n\nSpace \u00a0"),ranges:[{start:6,end:10,fill:"#1a65a6",textDecoration:"underline",textDecorationThickness:{unit:"px",value:1},textUnderlineOffset:{unit:"em",value:.1578},textDecorationSkipInk:"auto",href:"#"}]}});
  return value;
};
const textOf = value => value.nodes.find(n=>n.type==="text");
const sha = async bytes=>createHash("sha256").update(bytes).digest("hex");

test("strict normalizer/schema/public range payload preserve full authored state and enforce TEXT-only structure",async()=>{
  const {default:Ajv}=await import("ajv/dist/2020.js"), schema=JSON.parse(await readFile(new URL("../../../apps/design-studio/app/formats/codeshell-design-v3.schema.json",import.meta.url))),validate=new Ajv({strict:false}).compile(schema);
  const value=raw(), before=structuredClone(value);
  assert.equal(validate(value),true,JSON.stringify(validate.errors));
  const normalized=normalizeDesignDocument(value), text=textOf(normalized);
  assert.deepEqual(text.textRanges,value.pages[0].children[0].children[0].textRanges);
  assert.deepEqual(value,before);
  for(const mutate of [
    x=>x.pages[0].children[0].textRanges=x.pages[0].children[0].children[0].textRanges,
    x=>x.pages[0].children[0].children[0].textRanges.ranges[0].fontWeight=700,
    x=>x.pages[0].children[0].children[0].textRanges.ranges[0].textDecoration="none",
    x=>x.pages[0].children[0].children[0].textRanges.ranges[0].textUnderlineOffset={unit:"rem",value:1},
  ]){const candidate=raw();mutate(candidate);assert.equal(validate(candidate),false);assert.throws(()=>normalizeDesignDocument(candidate));}
  const stale=raw();stale.pages[0].children[0].children[0].textRanges.sourceSignature="[]";
  assert.throws(()=>normalizeDesignDocument(stale),{code:"TEXT_RANGES_STALE"});
  const manifest=JSON.parse(await readFile(new URL("../../../apps/design-studio/.codeshell-panel/panel.json",import.meta.url))),tool=manifest.agent.tools.find(t=>t.name==="use_design"),{validateToolArgsStrict}=await import("@cjhyy/code-shell-core");
  const request={expected_state_revision:"ranges",operations:[{op:"update_node",node_id:text.id,changes:{textRanges:text.textRanges}}]};
  assert.equal(validateToolArgsStrict("use_design",request,tool.inputSchema),null);
  request.operations[0].changes.textRanges=null;
  assert.equal(validateToolArgsStrict("use_design",request,tool.inputSchema),null);
  request.operations=[{op:"edit_text",node_id:text.id,start:6,end:10,text:"new link",affinity:"after",expectedSourceSignature:text.textRanges.sourceSignature}];
  assert.equal(validateToolArgsStrict("use_design",request,tool.inputSchema),null);
  delete request.operations[0].affinity;
  assert.ok(validateToolArgsStrict("use_design",request,tool.inputSchema));
});

test("save/reopen/portable keep exact source/ranges; stale flat serialization/export/layout reject before mutation",async()=>{
  const value=normalizeDesignDocument(raw()), saved=serializeDesignDocument(value), reopened=normalizeDesignDocument(JSON.parse(saved));
  assert.equal(serializeDesignDocument(reopened),saved);
  const portable=await createPortableDesign({document:reopened,source:{workspaceRoot:"/fixture",sessionId:"ranges",path:"designs/ranges.codesign.json"},sha256Bytes:sha});
  const planned=await planPortableDesign(portable,{sha256:sha,sha256Bytes:sha});
  assert.equal(planned.primarySource,saved);
  const text=textOf(reopened);text.textSource="stale";const before=structuredClone(reopened);
  for(const call of [()=>serializeDesignDocument(reopened),()=>exportDesignSvg(reopened),()=>applyAutoLayouts(reopened.nodes,[text.parentId])])
    assert.throws(call,{code:"TEXT_RANGES_STALE"});
  assert.deepEqual(reopened,before);
});

test("indexed wrapping exactly reconstructs explicit/soft LF, hanging whitespace and Unicode with legacy line output",()=>{
  for(const source of ["Alpha beta gamma delta","  Leading spaces  \n\nNext\u00a0line😀 end ","A\r\nB\n",""]){
    const result=measuredWrapSource(source,45,value=>({width:[...value].length*8}));
    assert.equal(result.lines.map(line=>source.slice(line.sourceStart,line.sourceEnd)+(line.breakAfter==="hard"?"\n":"")).join(""),source);
    assert.equal(result.lines.map(line=>result.displayText.slice(line.displayStart,line.displayEnd)).join("\n"),result.displayText);
    assert.deepEqual(measuredWrap(source,45,value=>({width:[...value].length*8})),result.displayText.split("\n"));
  }
});

test("public final patch validation requires coherent content or explicit clear and native characters never include synthetic LF",()=>{
  const value=textOf(normalizeDesignDocument(raw()));
  assert.throws(()=>validateTextRangeNodePatch(value,{text:"changed"}),{code:"TEXT_RANGES_STALE"});
  assert.throws(()=>validateTextRangeNodePatch(value,{text:"changed",textRanges:undefined}));
  assert.doesNotThrow(()=>validateTextRangeNodePatch(value,{text:"changed",textRanges:null}));
  assert.doesNotThrow(()=>validateTextRangeNodePatch(value,{fill:"#123456"}));
  const next=replaceTextRange(value,{start:6,end:10,text:"edited\n\n \u00a0",affinity:"after",expectedSourceSignature:value.textRanges.sourceSignature});
  assert.doesNotThrow(()=>validateTextRangeNodePatch(value,{text:next.text,textSource:next.textSource,textRanges:next.textRanges}));
  next.text=next.text.slice(0,3)+"\n"+next.text.slice(3);
  assert.equal(nativeTextContent(next),next.textSource);
  next.text=next.text.replace("Alp","Oth");
  assert.throws(()=>nativeTextContent(next),{code:"TEXT_RANGES_DISPLAY_MISMATCH"});
});

test("shared range validation/edits work with no URL, TextEncoder or structuredClone sandbox globals",async()=>{
  const output=await build({entryPoints:["apps/design-studio/app/text-ranges.mjs"],bundle:true,format:"iife",globalName:"Ranges",platform:"neutral",write:false,logLevel:"silent"});
  const value=textOf(normalizeDesignDocument(raw())), context={};
  runInNewContext(output.outputFiles[0].text+`\nconst value=JSON.parse(${JSON.stringify(JSON.stringify(value))});\nglobalThis.result={globals:[typeof URL,typeof TextEncoder,typeof structuredClone],payload:Ranges.validateTextRanges(value),edited:Ranges.replaceTextRange(value,{start:6,end:10,text:'new',affinity:'after',expectedSourceSignature:value.textRanges.sourceSignature})};`,context);
  assert.deepEqual([...context.result.globals],["undefined","undefined","undefined"]);
  assert.equal(context.result.payload.sourceSignature,value.textRanges.sourceSignature);
  assert.equal(context.result.edited.text.slice(6,9),"new");
});
