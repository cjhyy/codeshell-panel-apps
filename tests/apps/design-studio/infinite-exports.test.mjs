import assert from "node:assert/strict";
import { test } from "node:test";
import {
  exportDesignFrontend,
  exportDesignPrototype,
  fixtureDocument,
  fixturePrototype,
  pageTag,
  styleFor,
} from "./infinite-exports.fixture.mjs";

test("infinite HTML export includes negative and distant boards using their content origin", () => {
  const document = fixtureDocument();
  const before = JSON.stringify(document);
  const html = exportDesignFrontend(document);
  const page = pageTag(html, "boards");
  assert.match(page, /data-codeshell-origin-x="-800"/u);
  assert.match(page, /data-codeshell-origin-y="-500"/u);
  assert.match(page, /width:5080px/u);
  assert.match(page, /height:2080px/u);
  assert.match(styleFor(html, "west-board"), /left:0px;top:0px/u);
  assert.match(styleFor(html, "east-board"), /left:4800px;top:1900px/u);
  assert.equal(JSON.stringify(document), before, "export must not move the source design");
  assert.equal(exportDesignFrontend(document), html, "export must stay deterministic");
});

test("infinite root geometry ignores document constraints while Frame child constraints survive", () => {
  const html = exportDesignFrontend(fixtureDocument({ rootConstraints: true }));
  const root = styleFor(html, "west-board");
  assert.match(root, /left:0px;top:0px/u);
  assert.match(root, /width:320px;height:240px/u);
  assert.doesNotMatch(root, /(?:right:|bottom:|translate[XY]|calc\()/u);
  const child = styleFor(html, "west-content");
  assert.match(child, /left:20px;right:30px;top:30px/u);
  assert.doesNotMatch(child, /(?:^|;)width:/u, "the real parent Frame still owns stretched width");
});

test("infinite multipage prototype gives each page its own bounds and retains navigation IDs", () => {
  const document = fixtureDocument();
  const html = exportDesignPrototype(document, { prototype: fixturePrototype() });
  assert.match(pageTag(html, "boards"), /width:5080px;height:2080px/u);
  assert.match(pageTag(html, "detail"), /width:200px;height:100px/u);
  assert.match(pageTag(html, "detail"), /data-codeshell-origin-x="-60"/u);
  assert.match(pageTag(html, "detail"), /data-codeshell-origin-y="-90"/u);
  assert.match(styleFor(html, "detail-board"), /left:0px;top:0px/u);
  assert.match(html, /data-prototype-link="to-detail" href="#detail"/u);
  assert.match(html, /data-prototype-link="back" href="#prototype-back"/u);
});

test("bounded HTML and prototype retain the existing viewport and root constraints", () => {
  const document = fixtureDocument({ infinite: false, rootConstraints: true });
  const html = exportDesignFrontend(document);
  assert.match(html, /width: min\(100%, 1200px\)/u);
  assert.match(html, /height: 800px/u);
  assert.doesNotMatch(pageTag(html, "boards"), /data-codeshell-origin/u);
  assert.match(styleFor(html, "west-board"), /left:10px;right:20px/u);
  assert.match(styleFor(html, "west-board"), /translateY\(-50%\)/u);
  const prototype = exportDesignPrototype(document, { prototype: fixturePrototype() });
  assert.match(prototype, /width:min\(100%,1200px\)/u);
  assert.doesNotMatch(pageTag(prototype, "detail"), /data-codeshell-origin/u);
});
