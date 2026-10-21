import assert from "node:assert/strict";
import { test } from "node:test";
import {
  textRangeSourceSignature, validateTextRanges, mapTextDisplay, projectTextRanges,
  replaceTextRange, setTextRangeStyle, isSafeTextRangeHref,
} from "../../../apps/design-studio/app/text-ranges.mjs";

const source = "You have 7 days left to send your application. View application.";
const link = { start: 47, end: 63, fill: "#1a65a6", textDecoration: "underline",
  textDecorationThickness: { unit: "px", value: 1 }, textUnderlineOffset: { unit: "em", value: 0.1578 },
  textDecorationSkipInk: "auto", href: "#" };
const node = (text = source, ranges = [link]) => ({ type: "text", text, fontSize: 24, fill: "#0b0c0c",
  textRanges: { version: 1, sourceSignature: textRangeSourceSignature(text), ranges: structuredClone(ranges) } });
const edit = (value, start, end, text, affinity = "after") => replaceTextRange(value, {
  start, end, text, affinity, expectedSourceSignature: textRangeSourceSignature(value.textSource ?? value.text),
});

test("paint/link ranges bind complete source and normalize owned adjacent overrides without losing explicit inheritance", () => {
  const value = node("ABCD", [{start:0,end:1,fill:"#AABBCC"},{start:1,end:2,fill:"#aabbcc"},{start:2,end:3,fill:"#0b0c0c"}]);
  const before = structuredClone(value), normalized = validateTextRanges(value);
  assert.deepEqual(normalized.ranges, [{start:0,end:2,fill:"#aabbcc"},{start:2,end:3,fill:"#0b0c0c"}]);
  normalized.ranges[0].fill = "#ffffff";
  assert.deepEqual(value, before);
  assert.equal(validateTextRanges({...value,textRanges:undefined}), undefined);
  assert.equal(validateTextRanges(node("A", [])), undefined);
});

test("strict range rejection covers stale source, unknown fields, sparse arrays, overlap and scalar boundaries", () => {
  for (const mutate of [
    x => x.textRanges.sourceSignature = "[\"stale\"]",
    x => x.textRanges.other = true,
    x => x.textRanges.ranges[0].fontSize = 12,
    x => x.textRanges.ranges = Array(1),
    x => x.textRanges.ranges = [{start:1,end:3,fill:"#123456"},{start:2,end:4,fill:"#123456"}],
    x => x.textRanges.ranges[0].start = 47.5,
    x => x.textRanges.ranges[0].fill = "transparent",
    x => x.textRanges.ranges[0].textUnderlineOffset = {unit:"em",value:Infinity},
    x => x.textRanges.ranges[0].textDecorationThickness = {unit:"auto",value:1},
    x => delete x.textRanges.ranges[0].textDecoration,
    x => x.textOverflow = "ellipsis",
    x => x.type = "rectangle",
  ]) {
    const value = node(); mutate(value); const before = structuredClone(value);
    assert.throws(() => validateTextRanges(value)); assert.deepEqual(value, before);
  }
  assert.throws(() => node("\ud800", []));
  assert.throws(() => validateTextRanges(node("A😀B", [{start:1,end:2,fill:"#112233"}])));
  assert.doesNotThrow(() => validateTextRanges(node("A😀B", [{start:1,end:3,fill:"#112233"}])));
  assert.throws(() => validateTextRanges(node("A", [{start:0,end:1,textDecoration:"underline",textUnderlineOffset:{unit:"em",value:10}}])));
});

test("range count and escaped UTF8 budgets reject before truncation; safe links preserve literal target", () => {
  const ranges = Array.from({length:65}, (_,i)=>({start:i,end:i+1,fill:"#123456"}));
  assert.throws(() => validateTextRanges(node("x".repeat(65), ranges)));
  const many = Array.from({length:32}, (_,i)=>({start:i,end:i+1,href:"https://example.com/"+"x".repeat(1500)}));
  assert.throws(() => validateTextRanges(node("x".repeat(32), many)));
  for (const href of ["#","#section","https://example.com/a?b=c","mailto:a@example.com","tel:123"])
    assert.equal(isSafeTextRangeHref(href), true, href);
  for (const href of ["javascript:alert(1)","data:text/plain,a","file:///a","/relative"," #","#\n","https://example.com/\ud800"])
    assert.equal(isSafeTextRangeHref(href), false, href);
});

test("source/display mapping preserves every byte, repeated words, hard LF, CRLF, NBSP and surrogate scalars", () => {
  const text = " A😀\u00a0A\r\nA\n\nB ", value = node(text, [{start:2,end:4,fill:"#123456"}]);
  value.textSource = text; value.textFlow = "wrap";
  value.text = " A😀\u00a0\nA\r\nA\n\nB ";
  const map = mapTextDisplay(value), sourceParts = map.segments.filter(x=>x.kind==="source");
  assert.equal(sourceParts.map(x=>map.sourceText.slice(x.sourceStart,x.sourceEnd)).join(""), text);
  assert.equal(map.segments.map(x=>map.displayText.slice(x.displayStart,x.displayEnd)).join(""), value.text);
  assert.equal(map.segments.filter(x=>x.kind==="soft-break").length, 1);
  const projected = projectTextRanges(value, map);
  assert.equal(projected.map(x=>x.text).join(""), value.text);
  assert.equal(projected.find(x=>x.kind==="soft-break").style, undefined);
  assert.throws(()=>projectTextRanges(value,{...map,sourceText:"wrong"}));
  for (const bad of [value.text.replace("\u00a0"," "),value.text.replace("B","C"),value.text.slice(0,-1)])
    assert.throws(()=>mapTextDisplay({...value,text:bad}),{code:"TEXT_RANGES_DISPLAY_MISMATCH"});
  assert.throws(()=>mapTextDisplay({...value,textFlow:undefined}));
});

test("range projection uses source indices across soft lines and includes inherited gaps without link expansion", () => {
  const value = node(); value.textSource=source; value.textFlow="wrap";
  value.text=source.slice(0,52)+"\n"+source.slice(52);
  const runs=projectTextRanges(value);
  assert.equal(runs.map(x=>x.text).join(""),value.text);
  assert.equal(runs.filter(x=>x.href).map(x=>x.text).join(""),"View application");
  assert.equal(runs.find(x=>x.text===".").href,undefined);
  assert.deepEqual(runs.filter(x=>x.href).map(x=>x.lineIndex),[0,1]);
  assert.equal(runs[0].style.fill,"#0b0c0c");
});

test("replacement affinity is selected before deletion and preserves original node and exact authored characters", () => {
  const value=node(), before=structuredClone(value);
  const selected=edit(value,47,63,"Open", "after");
  assert.equal(selected.text,source.slice(0,47)+"Open.");
  assert.deepEqual(selected.textRanges.ranges,[{...link,start:47,end:51}]);
  const beforeLink=edit(value,47,47,"!", "before");
  assert.equal(beforeLink.textRanges.ranges[0].start,48);
  const atLink=edit(value,47,47,"!", "after");
  assert.equal(atLink.textRanges.ranges[0].start,47); assert.equal(atLink.textRanges.ranges[0].end,64);
  const afterLink=edit(value,63,63,"!", "before");
  assert.equal(afterLink.textRanges.ranges[0].end,64);
  const plainAfter=edit(value,63,63,"!", "after");
  assert.equal(plainAfter.textRanges.ranges[0].end,63);
  const none=edit(value,50,50,"\n\n \u00a0", "none");
  assert.equal(none.text.slice(50,54),"\n\n \u00a0"); assert.equal(none.textRanges.ranges.length,2);
  const deleted=edit(value,47,63,"",undefined); assert.equal(deleted.textRanges,undefined);
  assert.deepEqual(value,before);
  assert.throws(()=>replaceTextRange(value,{start:0,end:0,text:"X",expectedSourceSignature:"stale"}),{code:"TEXT_RANGES_STALE"});
  assert.throws(()=>replaceTextRange(value,{start:0,end:0,text:"X",expectedSourceSignature:textRangeSourceSignature(source)}));
});

test("style edit splits gaps, null removes overrides, explicit equality survives scalar edits and decoration clear removes geometry", () => {
  const value=node(); value.textSource=source; value.textFlow="wrap"; value.textMetrics={example:"untouched"};
  const apply=(value,start,end,style)=>setTextRangeStyle(value,{start,end,style,expectedSourceSignature:textRangeSourceSignature(source)});
  const equal=apply(value,0,3,{fill:value.fill}); equal.fill="#ffffff";
  assert.equal(projectTextRanges(equal)[0].style.fill,"#0b0c0c");
  const cleared=apply(value,47,63,{textDecoration:"none",href:null});
  assert.deepEqual(cleared.textRanges.ranges,[{start:47,end:63,fill:link.fill,textDecoration:"none"}]);
  assert.deepEqual(cleared.textMetrics,value.textMetrics);
  const inherit=apply(value,47,63,Object.fromEntries(Object.keys(link).filter(x=>!["start","end"].includes(x)).map(x=>[x,null])));
  assert.equal(inherit.textRanges,undefined);
  assert.throws(()=>apply(value,47,63,{textDecoration:"none",textUnderlineOffset:{unit:"px",value:3}}));
  assert.throws(()=>apply(value,2,2,{fill:"#123456"}));
});
