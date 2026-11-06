import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { renderFidelityFixture, fidelityNode } from "./render-fidelity.fixture.mjs";
import { inkGeometry, geometryDifference, textGeometryFailures, symmetricPixelDifference } from "./render-fidelity.metrics.mjs";
import { normalizeDesignDocument, serializeDesignDocument, exportDesignSvg } from "../../../apps/design-studio/app/document.mjs";
import { renderDesignFrontendPage } from "../../../apps/design-studio/app/frontend-export.mjs";

const ids = new Set(["finite-offset", "finite-offset-negative", "finite-offset-native"]);
const nodes = renderFidelityFixture().pages.find(page => page.id === "variants").children.filter(node => ids.has(node.id)).map(({fontRef, ...node}) => node);
function fixture(flow) {
  const children = nodes.map(node => flow ? fidelityNode(`owner-${node.id}`, "frame", node.x, node.y - node.layoutBaselineOffset, node.width, node.height,
    { fill: "transparent", layout: typeof flow === "string" ? flow : "vertical", children: [structuredClone(node)] }) : structuredClone(node));
  return {format:"codeshell.design",version:3,name:"Finite HTML origin",canvas:{width:640,height:470,background:"#ffffff"},tokens:{colors:[]},resources:[],activePageId:"page",pages:[{id:"page",name:"Page",children}]};
}

test("browser HTML transports finite hanging origins without mutating saved geometry; strict pixels remain measured", async t => {
  const output = resolve(process.env.DESIGN_FINITE_HTML_EVIDENCE ?? ".tmp/render-fidelity-r005/finite");
  await mkdir(output, {recursive:true});
  const root = resolve("apps/design-studio/app"), origin = "https://finite-origin.test";
  const browser = await chromium.launch({headless:true});
  t.after(() => browser.close());
  const font = await readFile(resolve(root,"fonts/InterVariable.woff2"));
  const fontCss = `@font-face{font-family:"Fidelity Inter";src:url(data:font/woff2;base64,${font.toString("base64")});font-weight:100 900}body{margin:0;background:white}`;
  const rows=[];
  for(const dpr of [1,2]) {
    const page=await browser.newPage({viewport:{width:640,height:470},deviceScaleFactor:dpr});
    await page.route("**/*",async route=>{
      const url=new URL(route.request().url()),path=resolve(root,`.${url.pathname}`);
      if(url.origin!==origin)return route.abort();
      if(url.pathname==="/")return route.fulfill({contentType:"text/html",body:`<!doctype html><style>${fontCss}</style><body></body>`});
      if(!path.startsWith(root+sep)||!path.endsWith(".mjs"))return route.abort();
      return route.fulfill({contentType:"text/javascript",body:await readFile(path)});
    });
    await page.goto(origin);
    await page.evaluate(async()=>{await document.fonts.load('600 16px "Fidelity Inter"');await document.fonts.ready;});
    for(const flow of [false,"vertical","horizontal"]) {
      const input=fixture(flow),design=normalizeDesignDocument(input),saved=serializeDesignDocument(design),svg=exportDesignSvg(design);
      const geometry=await page.evaluate(async({input})=>{
        const {normalizeDesignDocument,serializeDesignDocument}=await import("/document.mjs");
        const {renderDesignFrontendPage,designFrontendCss}=await import("/frontend-export.mjs");
        const {textLineBoxAlphabeticOffset}=await import("/text-line-box.mjs");
        const {designFontFamilyCss}=await import("/font-css.mjs");
        const design=normalizeDesignDocument(input),before=serializeDesignDocument(design);
        document.querySelector("#export-style")?.remove();
        const style=document.createElement("style");style.id="export-style";style.textContent=designFrontendCss(design);document.head.append(style);
        document.body.innerHTML=renderDesignFrontendPage(design);
        const ctx=document.createElement("canvas").getContext("2d");
        const nodes=design.nodes.filter(node=>node.type==="text").map(node=>{
          const element=document.querySelector(`[data-codeshell-source-id="${node.id}"]`),computed=getComputedStyle(element);
          ctx.font=`${node.fontStyle??"normal"} ${node.fontWeight} ${node.fontSize}px ${designFontFamilyCss(node.fontFamily)}`;
          ctx.textBaseline="hanging";const hanging=ctx.measureText("Hg");
          ctx.textBaseline="alphabetic";const alpha=ctx.measureText("Hg");
          const h2a=alpha.actualBoundingBoxAscent-hanging.actualBoundingBoxAscent;
          const lineBoxOffset=textLineBoxAlphabeticOffset(node,{ascent:alpha.fontBoundingBoxAscent,descent:alpha.fontBoundingBoxDescent});
          return {id:node.id,savedY:node.y,offset:node.layoutBaselineOffset,hangingToAlphabetic:h2a,lineBoxAlphabeticOffset:lineBoxOffset,renderedTop:element.getBoundingClientRect().top,cssTop:computed.top,position:computed.position};
        });
        if(serializeDesignDocument(design)!==before)throw Error("Rendering mutated the document");
        return nodes;
      },{input});
      await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
      const stem=`${flow||"absolute"}-dpr${dpr}`;
      const actual=PNG.sync.read(await page.screenshot({path:resolve(output,`${stem}-html.png`)}));
      await page.evaluate(svg=>{document.querySelector("#export-style")?.remove();document.body.innerHTML=svg;},svg);
      const expected=PNG.sync.read(await page.screenshot({path:resolve(output,`${stem}-hanging-svg.png`)}));
      for(const node of nodes) {
        const roi={x:(node.x-6)*dpr,y:(node.y-18)*dpr,width:(node.width+12)*dpr,height:node.fontSize*3*dpr};
        const options={roi,foreground:[17,17,17]},delta=geometryDifference(inkGeometry(expected,options),inkGeometry(actual,options));
        const measured=geometry.find(row=>row.id===node.id),d=measured.hangingToAlphabetic-measured.lineBoxAlphabeticOffset+(flow?node.layoutBaselineOffset:0);
        const expectedTop=flow ? node.y-node.layoutBaselineOffset+Math.trunc(d*64)/64 : Math.trunc((node.y+d)*64)/64;
        rows.push({id:node.id,flow,dpr,...measured,expectedTop,formulaMatches:measured.renderedTop===expectedTop,delta,pixel:symmetricPixelDifference(expected,actual,{roi}),failures:textGeometryFailures(delta,{scale:dpr,align:node.textAlign})});
      }
      assert.equal(serializeDesignDocument(design),saved);
      assert.equal(exportDesignSvg(design),svg,"browser frontend changes must not alter the finite SVG output");
      const unchangedCases=[];
      for(const source of ["html","native"]){
        const value=normalizeDesignDocument(input);
        for(const node of value.nodes.filter(node=>node.type==="text"))node.layoutBaselineSource=source;
        unchangedCases.push({label:`${flow||"absolute"}-${source}`,design:value,expected:renderDesignFrontendPage(value)});
      }
      if(!flow)for(const patch of [{rotation:15},{constraintVertical:"end"},{constraintVertical:"center"},{constraintVertical:"stretch"},{constraintTop:150},{layoutBaselineOffset:undefined}]){
        const value=normalizeDesignDocument(input);
        for(const node of value.nodes.filter(node=>node.type==="text"))Object.assign(node,patch);
        unchangedCases.push({label:JSON.stringify(patch),design:value,expected:renderDesignFrontendPage(value)});
      }
      const unchangedHtml=await page.evaluate(async cases=>{
        const {renderDesignFrontendPage}=await import("/frontend-export.mjs");
        return cases.map(value=>({label:value.label,html:renderDesignFrontendPage(value.design)}));
      },unchangedCases.map(({label,design})=>({label,design})));
      assert.deepEqual(unchangedHtml,unchangedCases.map(value=>({label:value.label,html:value.expected})),"provenanced HTML/native and unverified scope must keep exact existing CSS semantics");

    }
    await page.close();
  }
  const failures=rows.filter(row=>row.failures.length);
  await writeFile(resolve(output,"metrics.json"),JSON.stringify({samples:rows.length,visualAccepted:failures.length===0,failures,rows},null,2));
  assert.equal(rows.length,18);
  assert(rows.every(row=>row.formulaMatches),"each rendered CSS box must follow the measured hanging-to-line-box formula");
  assert.deepEqual(rows.filter(row=>row.dpr===1&&row.failures.length),[],"DPR 1 must meet the unchanged strict text geometry gate");
  t.diagnostic(JSON.stringify({output,samples:rows.length,strictVisualAccepted:failures.length===0,strictVisualFailures:failures.length}));
});

test("Node HTML keeps finite origin diagnostic while SVG and saved coordinates remain stable",()=>{
  const design=normalizeDesignDocument(fixture(false)),before=serializeDesignDocument(design),svg=exportDesignSvg(design);
  const html=renderDesignFrontendPage(design);
  assert(html.includes("top:150px"));
  assert(html.includes("top:325px"));
  assert(html.includes("top:403px"));
  assert.equal(serializeDesignDocument(design),before);
  assert.equal(exportDesignSvg(design),svg);
});
