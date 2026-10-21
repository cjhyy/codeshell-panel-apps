import assert from "node:assert/strict";
import { test } from "node:test";
import { createDesignRuntimeFontFamily, designRuntimeFontFamilyCss, designTextFontResourceIds } from "../../../apps/design-studio/app/font-css.mjs";
import { parseDesignFontFamily } from "../../../apps/design-studio/app/font-family.mjs";

test("runtime aliases preserve parsed named/generic order without enlarging canonical font admission", () => {
  const family = '"A, B", "serif", serif, Later, system-ui';
  const token = createDesignRuntimeFontFamily(family, {resourceFamily:"A, B",resourceAlias:"selected",aliases:[{name:"serif",alias:"named-serif"},{name:"Later",alias:"later400-and900"}]});
  assert.equal(designRuntimeFontFamilyCss(token), '"selected", "named-serif", serif, "later400-and900", system-ui');
  assert.equal(designRuntimeFontFamilyCss(createDesignRuntimeFontFamily('A\\2c B, Later', {aliases:[{name:"a,b",alias:"same-literal"}]})), '"same-literal", "Later"');
  const long = Array.from({length:20},(_,i)=>`F${i}`).join(",");
  const runtime = createDesignRuntimeFontFamily(long,{aliases:Array.from({length:20},(_,i)=>({name:`F${i}`,alias:`private-resource-${i}-`+"x".repeat(60)}))});
  assert(parseDesignFontFamily(long));assert.equal(parseDesignFontFamily(designRuntimeFontFamilyCss(runtime)),null);
  for(const fake of ["body{display:none}",{},structuredClone(token),JSON.parse(JSON.stringify(token)),null])assert.throws(()=>designRuntimeFontFamilyCss(fake),/private generated/u);
  for(const family of ["x".repeat(121),'"unclosed',"Arial,"])assert.throws(()=>createDesignRuntimeFontFamily(family),/canonical/u);
  assert.throws(()=>createDesignRuntimeFontFamily("Arial",{aliases:[{name:"Arial",alias:"bad\nname"}]}),/alias/u);
});

test("an explicitly mismatched primary resource retains its resource-only override", () => {
  assert.equal(designRuntimeFontFamilyCss(createDesignRuntimeFontFamily("Arial, serif",{resourceFamily:"Other",resourceAlias:"selected",aliases:[{name:"Arial",alias:"later"}]})), '"selected"');
  assert.equal(designRuntimeFontFamilyCss(createDesignRuntimeFontFamily("serif, Arial",{resourceFamily:"serif",resourceAlias:"selected"})), '"selected"');
  assert.equal(designRuntimeFontFamilyCss(createDesignRuntimeFontFamily('"serif", Arial',{resourceFamily:"serif",resourceAlias:"selected"})), '"selected", "Arial"');
});

test("referenced font resources include every supplied named fallback face while respecting CSS generics", () => {
  const resources=[{id:"first",kind:"font",family:"A, B",weight:900,style:"normal"},{id:"named-generic",kind:"font",family:"serif",weight:400,style:"normal"},{id:"later400",kind:"font",family:"Later",weight:400,style:"normal"},{id:"later900",kind:"font",family:"later",weight:900,style:"italic"},{id:"unused",kind:"font",family:"Other",weight:400,style:"normal"}];
  assert.deepEqual(designTextFontResourceIds({type:"text",fontRef:"first",fontFamily:'"a, b", "serif", Later, sans-serif'},resources),["first","named-generic","later400","later900"]);
  assert.deepEqual(designTextFontResourceIds({type:"text",fontFamily:"serif, Later"},resources),["later400","later900"]);
  assert.deepEqual(designTextFontResourceIds({type:"text",fontRef:"first",fontFamily:"Later, serif"},resources),["first"]);
  assert.deepEqual(designTextFontResourceIds({type:"text",fontRef:"first",fontFamily:"bad,"},resources),["first"]);
  assert.deepEqual(designTextFontResourceIds({type:"rectangle",fontRef:"first",fontFamily:"Later"},resources),[]);
});
