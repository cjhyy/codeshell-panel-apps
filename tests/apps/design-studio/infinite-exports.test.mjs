import assert from "node:assert/strict";
import { test } from "node:test";
import {
  exportDesignFrontend,
  renderDesignFrontendPage,
  designFrontendCss,
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

test("live browser markup preserves world coordinates while portable output uses its content origin", () => {
  const document = fixtureDocument({ rootConstraints: true });
  const source = JSON.stringify(document);
  const live = renderDesignFrontendPage(document, { preserveWorldOrigin: true });
  assert.match(styleFor(live, "west-board"), /left:-800px;top:-500px;[\s\S]*width:320px;height:240px/u);
  assert.match(styleFor(live, "east-board"), /left:4000px;top:1400px/u);
  assert.match(styleFor(live, "west-content"), /left:20px;right:30px;top:30px/u);
  assert.match(pageTag(live, "boards"), /data-codeshell-origin-x="0" data-codeshell-origin-y="0"/u);
  assert.match(pageTag(live, "boards"), /width:5080px;height:2080px;margin:0;overflow:visible;background:transparent/u);
  const css = designFrontendCss(document, { preserveWorldOrigin: true });
  assert.match(css, /body \{ background: transparent; \}/u);
  assert.match(css, /width: 5080px;[\s\S]*height: 2080px;[\s\S]*overflow: visible;[\s\S]*background: transparent;/u);
  const detailCss = designFrontendCss(document, { pageId: "detail" });
  assert.match(detailCss, /width: 200px;[\s\S]*height: 100px/u);
  const portable = exportDesignFrontend(document);
  assert.match(styleFor(portable, "west-board"), /left:0px;top:0px/u);
  assert.match(portable, /body \{ background: #eeeeee; \}/u);
  assert.equal(JSON.stringify(document), source);
});
