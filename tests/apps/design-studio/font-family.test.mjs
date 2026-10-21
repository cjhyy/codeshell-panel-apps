import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDesignFontFamily, nativeDesignFontFamily } from "../../../apps/design-studio/app/font-family.mjs";
import { designFontFamilyCss, designNamedFontFamilyCss, designResourceFontFamilyCss } from "../../../apps/design-studio/app/font-css.mjs";
import { htmlFontResources } from "../../../apps/design-studio/app/html-import-assets.mjs";
import { importFigmaJson, createFigmaTransfer } from "../../../apps/design-studio/app/figma-bridge.mjs";
import { serializeDesignDocument, normalizeDesignDocument } from "../../../apps/design-studio/app/document.mjs";
import { preparePluginFile } from "../../../apps/design-studio/app/figma-plugin/v3-input.mjs";

test("quoted commas, CSS escapes and quoted generic-looking names retain distinct family semantics", () => {
  const cases = [
    ['"A, B", monospace', ["A, B", "monospace"], '"A, B", monospace'],
    ['A\\2c B, serif', ["A,B", "serif"], '"A,B", serif'],
    ['"Quote\\\"Name", sans-serif', ['Quote"Name', "sans-serif"], '"Quote\\\"Name", sans-serif'],
    ['"Slash\\\\Name", system-ui', ['Slash\\Name', "system-ui"], '"Slash\\\\Name", system-ui'],
    ['"serif"', ['serif'], '"serif"'],
    ['SERIF', ['SERIF'], 'serif'],
    ['" A  B "', [' A  B '], '" A  B "'],
    ['Font Awesome 5 Free', ['Font Awesome 5 Free'], '"Font Awesome 5 Free"'],
  ];
  for (const [input, names, output] of cases) {
    assert.deepEqual(parseDesignFontFamily(input).map(f => f.name), names, input);
    assert.equal(designFontFamilyCss(input), output, input);
    assert.deepEqual(parseDesignFontFamily(output).map(f => [f.name.toLowerCase(), f.generic]),
      parseDesignFontFamily(input).map(f => [f.name.toLowerCase(), f.generic]));
  }
  for (const input of ['', 'Arial,', ',Arial', '"unclosed', '"A" B', 'Arial\\', 'inherit', 'x'.repeat(121), 'A\nB', '"A\\a B"', '"A\\7f B"'])
    assert.equal(parseDesignFontFamily(input), null, JSON.stringify(input));
  assert.equal(designNamedFontFamilyCss('A, B'), '"A, B"');
  assert.equal(designResourceFontFamilyCss('"A, B", serif', 'A, B'), '"A, B", serif');
  assert.equal(designResourceFontFamilyCss('A, B', 'A, B'), '"A, B"');
});

test("local font declarations retain one literal family instead of silently splitting its comma or escape", () => {
  for (const [css, name] of [['"A, B"', 'A, B'], ['"Quote\\\"Name"', 'Quote"Name'], ['"serif"', 'serif']]) {
    const result = htmlFontResources(`@font-face{font-family:${css};font-weight:400;src:url(data:font/woff2;base64,d09GMg==)}`);
    assert.equal(result.length, 1); assert.equal(result[0].family, name);
  }
  const warnings = [];
  assert.deepEqual(htmlFontResources('@font-face{font-family:A,B;src:url(data:font/woff2;base64,d09GMg==)}', warnings), []);
  assert.equal(warnings[0].code, 'font-face-unsupported');
});

test("native new-page boundary refuses CSS choice and ambiguous literal names while retaining named single fonts", () => {
  for (const fontFamily of ['Inter', 'Arial', 'Fixture Sans', '"Fixture Sans"', 'Fixture\\20 Sans']) {
    const value = { type:'text', id:'copy', fontFamily };
    const raw = JSON.stringify(value);
    assert.equal(nativeDesignFontFamily(value), fontFamily === 'Fixture\\20 Sans' || fontFamily === '"Fixture Sans"' ? 'Fixture Sans' : fontFamily);
    assert.equal(JSON.stringify(value), raw);
  }
  for (const fontFamily of ['Inter, sans-serif','ui-sans-serif','system-ui','"serif"','"A, B"','"Quote\\\"Name"','" A "','Arial,'])
    assert.throws(() => nativeDesignFontFamily({type:'text',fontFamily}), {code:'NATIVE_CSS_FONT_FAMILY'}, fontFamily);
  assert.equal(nativeDesignFontFamily({type:'rectangle',fontFamily:'A,B'}), null);
});

test("new-page transfer refuses an unproved stack without rewriting canonical, raw source or saved font bytes", () => {
  const source = {document:{type:'DOCUMENT',id:'0:0',children:[{type:'CANVAS',id:'0:1',children:[{
    id:'1:1', type:'TEXT', characters:'Source bytes', absoluteBoundingBox:{x:0,y:0,width:200,height:30},
    style:{fontFamily:'Inter',fontSize:20,fontWeight:400},
  }]}]}};
  const imported = importFigmaJson(source).document;
  const raw = JSON.stringify(source), existing = createFigmaTransfer(imported);
  assert.equal(existing.pages[0].children[0].fontFamily, 'Inter');
  imported.nodes.find(n=>n.type==='text').fontFamily='"Missing First", Inter, sans-serif';
  const saved = serializeDesignDocument(imported), reopened = normalizeDesignDocument(JSON.parse(saved));
  assert.equal(reopened.nodes.find(n=>n.type==='text').fontFamily, '"Missing First", Inter, sans-serif');
  assert.throws(() => createFigmaTransfer(reopened), {code:'NATIVE_CSS_FONT_FAMILY'});
  assert.equal(serializeDesignDocument(reopened), saved);
  assert.equal(JSON.stringify(source), raw);
});

test("production UI transfer files cannot bypass family refusal or silently decode CSS as an SDK name", async () => {
  for (const fontFamily of ['Inter, sans-serif','ui-sans-serif','"Fixture Sans"','"A, B"']) {
    const transfer={format:'codeshell.figma.transfer',version:1,pages:[{children:[{type:'text',fontFamily}]}]};
    const raw=JSON.stringify(transfer);
    await assert.rejects(preparePluginFile(raw),{code:'NATIVE_CSS_FONT_FAMILY'});
    assert.equal(JSON.stringify(transfer),raw);
  }
  const raw=JSON.stringify({format:'codeshell.figma.transfer',version:1,pages:[{children:[{type:'text',fontFamily:'Inter'}]}]});
  assert.equal(JSON.stringify((await preparePluginFile(raw)).transfer),raw);
});
