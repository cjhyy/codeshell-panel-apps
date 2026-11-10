import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { textLineBoxAlphabeticOffset, textLineBoxBaselineY } from "../../../apps/design-studio/app/text-line-box.mjs";
import { localFontObservation, cjkFontObservation, assertCjkCoverage } from "./font-raster-observation.mjs";

const probeFamilies = ["system-ui", "PingFang SC", "FidelityInter"];
async function loadInterProbeFont(page, fontSize) {
  const faces = await page.evaluate(async fontSize => {
    const loaded = await document.fonts.load(`400 ${fontSize}px FidelityInter`, "Hgx"); await document.fonts.ready;
    return loaded.map(face => ({ family: face.family, status: face.status, weight: face.weight, style: face.style }));
  }, fontSize);
  assert(faces.length > 0 && faces.every(face => face.family === "FidelityInter" && face.status === "loaded"),
    "the supplied Inter face must load explicitly; an empty fallback-only FontFaceSet result cannot pass");
  return faces;
}
async function fontGroups(page) {
  const pingFang = await localFontObservation(page);
  assert.equal(pingFang.missingFaceNegativeControl, false, "a missing local face must never be certified by fallback");
  if (process.platform === "darwin") assert(pingFang.available, "macOS must retain the original PingFang probes");
  const families = probeFamilies.filter(family => family !== "PingFang SC" || pingFang.available);
  const cjk = [];
  for (const family of families) {
    const observation = await cjkFontObservation(page, family === "system-ui" ? family : `"${family}"`);
    assertCjkCoverage(observation); cjk.push(observation);
  }
  return { families, pingFang, cjk };
}

function groupSampleCounts(rows, expectedPerFamily, pingFang) {
  const groups = probeFamilies.map(family => ({ family, requiredSamples: expectedPerFamily,
    actualSamples: rows.filter(row => row.family === family).length,
    status: family === "PingFang SC" && !pingFang.available ? "unavailable" : "measured",
    certification: family === "PingFang SC" && !pingFang.available ? "not-certified" : "see-test-result" }));
  for (const group of groups) assert.equal(group.actualSamples, group.status === "unavailable" ? 0 : expectedPerFamily,
    `${group.family} must retain its complete probe matrix when available`);
  return groups;
}

function ink(png, x, y, width, height) {
  let mass = 0, moment = 0, top = Infinity, bottom = -Infinity;
  for (let py = Math.max(0, Math.floor(y)); py < Math.min(png.height, Math.ceil(y + height)); py++)
    for (let px = Math.max(0, Math.floor(x)); px < Math.min(png.width, Math.ceil(x + width)); px++) {
      const alpha = (255 - png.data[(py * png.width + px) * 4]) / 255;
      if (alpha > 0) { top = Math.min(top, py); bottom = Math.max(bottom, py + 1); }
      mass += alpha; moment += (py + 0.5) * alpha;
    }
  assert(mass > 1, "origin probes must contain actual glyph ink");
  return { centroid: moment / mass, top, bottom, mass };
}

// This probe measures independently observable DOM baselines and screenshot ink.
// Candidate snaps are hypotheses recorded as evidence, never acceptance waivers.
test("Blink fractional origin spike records DOM baseline and glyph ink across loaded fonts and physical scales", async t => {
  const output = resolve(process.env.DESIGN_TEXT_ORIGIN_EVIDENCE ?? ".tmp/render-fidelity-r002/spike");
  await mkdir(output, { recursive: true });
  const font = await readFile(new URL("../../../apps/design-studio/app/fonts/InterVariable.woff2", import.meta.url));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const rows = [], fonts = {}, fontObservations = [], candidates = ["raw", "roundCss", "floorCss", "roundDevice", "floorDevice"];
  for (const [dpr, zoom] of [[1, 1], [2, 1], [1, 2], [2, 2]]) {
    const page = await browser.newPage({ viewport: { width: 1500, height: 850 }, deviceScaleFactor: dpr });
    await page.route("**/*", route => route.abort());
    await page.setContent(`<style>@font-face{font-family:FidelityInter;src:url(data:font/woff2;base64,${font.toString("base64")})}body{margin:0;background:white}main{position:absolute;inset:0;transform-origin:0 0;transform:scale(${zoom})}.probe{position:absolute;white-space:pre}</style><main></main>`);
    const interFaces = await loadInterProbeFont(page, 15);
    const available = { Inter: true, "system-ui": true };
    const group = await fontGroups(page); fontObservations.push({ dpr, zoom, interFaces, ...group });
    available["PingFang SC"] = group.pingFang.available;
    Object.assign(fonts, available);
    assert(available.Inter, "the supplied Inter bytes must be genuinely loaded");
    for (const family of group.families)
      for (const fontSize of [11, 13, 15]) for (const multiplier of [1.2, 1.6]) {
        const lineHeight = fontSize * multiplier;
        const metrics = await page.evaluate(({family, fontSize}) => {
          const ctx = document.createElement("canvas").getContext("2d");
          ctx.font = `400 ${fontSize}px ${family === "system-ui" ? family : `"${family}"`}`;
          const m = ctx.measureText("Hgx");
          return {ascent:m.fontBoundingBoxAscent, descent:m.fontBoundingBoxDescent};
        }, {family, fontSize});
        const offset = textLineBoxAlphabeticOffset({fontSize, lineHeight:multiplier}, metrics);
        const probes = await page.evaluate(({family,fontSize,lineHeight,offset,dpr,zoom,candidates}) => {
          const main = document.querySelector("main"); main.replaceChildren();
          const snap = (value, candidate) => candidate === "roundCss" ? Math.round(value) : candidate === "floorCss" ? Math.floor(value)
            : candidate === "roundDevice" ? Math.round(value*dpr*zoom)/(dpr*zoom) : candidate === "floorDevice" ? Math.floor(value*dpr*zoom)/(dpr*zoom) : value;
          return [0,.25,.5,.75].map((phase,index) => {
            const y = 20 + index*95 + phase, text = ["Hgx中", "Try汉", "Clq国"], cssFamily = family === "system-ui" ? family : `"${family}"`;
            const div = document.createElement("div"); div.className = "probe";
            div.style.cssText = `left:20px;top:${y}px;font:400 ${fontSize}px/${lineHeight}px ${cssFamily}`;
            const markers = text.map((line,i) => {
              div.append(document.createTextNode(line));
              const marker = document.createElement("span"); marker.style.cssText = "display:inline-block;width:0;height:0"; div.append(marker);
              if(i<text.length-1) div.append(document.createElement("br"));
              return marker;
            }); main.append(div);
            for(const [column,candidate] of candidates.entries()) {
              const svg = document.createElementNS("http://www.w3.org/2000/svg","svg"); svg.classList.add("probe");
              svg.style.cssText = `left:${120+column*100}px;top:0;width:95px;height:420px;overflow:visible`;
              svg.innerHTML = text.map((line,i)=>`<text x="0" y="${snap(y+i*lineHeight+offset,candidate)}" font-family="${family}" font-size="${fontSize}" font-weight="400">${line}</text>`).join(""); main.append(svg);
            }
            return {phase,y,baselines:markers.map(marker=>marker.getBoundingClientRect().top/zoom),
              top:div.getBoundingClientRect().top/zoom, computedLineHeight:getComputedStyle(div).lineHeight};
          });
        }, {family,fontSize,lineHeight,offset,dpr,zoom,candidates});
        const name = `${family.replaceAll(" ","-")}-${fontSize}-lh${multiplier}-dpr${dpr}-scale${zoom}`;
        const png = PNG.sync.read(await page.screenshot({path:resolve(output,`${name}.png`)})), scale=dpr*zoom;
        for(const probe of probes) for(let line=0;line<3;line++) {
          const baseline=probe.y+line*lineHeight+offset, cropY=(baseline-fontSize)*scale, cropHeight=lineHeight*scale;
          const html=ink(png,20*scale,cropY,80*scale,cropHeight), comparisons={};
          for(const [column,candidate] of candidates.entries()) {
            const actual=ink(png,(120+column*100)*scale,cropY,80*scale,cropHeight);
            comparisons[candidate]={...actual,deltaCentroid:actual.centroid-html.centroid,deltaTop:actual.top-html.top,deltaBottom:actual.bottom-html.bottom,deltaMass:actual.mass-html.mass};
          }
          rows.push({family,fontSize,lineHeight,multiplier,dpr,zoom,phase:probe.phase,line,authoredY:probe.y,domTop:probe.top,domBaseline:probe.baselines[line],formulaBaseline:baseline,domMinusFormula:probe.baselines[line]-baseline,metrics,html,comparisons});
        }
      }
    await page.close();
  }
  const summary=Object.fromEntries(candidates.map(candidate=>[candidate,{maxAbsCentroid:Math.max(...rows.map(row=>Math.abs(row.comparisons[candidate].deltaCentroid))),
    nonzeroCentroid:rows.filter(row=>Math.abs(row.comparisons[candidate].deltaCentroid)>0.01).length,
    beyondCentroid075:rows.filter(row=>Math.abs(row.comparisons[candidate].deltaCentroid)>.75).length}]));
  const groups = groupSampleCounts(rows, 288, fontObservations[0].pingFang);
  await writeFile(resolve(output,"metrics.json"),JSON.stringify({fonts,fontObservations,groups,samples:rows.length,candidates,summary,rows},null,2));
  assert.equal(rows.length,576 + (fontObservations[0].pingFang.available ? 288 : 0));
  assert(rows.every(row=>textLineBoxBaselineY({y:row.authoredY,fontSize:row.fontSize,lineHeight:row.multiplier},row.line,textLineBoxAlphabeticOffset({fontSize:row.fontSize,lineHeight:row.multiplier},row.metrics))===Math.round(row.domBaseline)),"shared paint origin must match independent DOM baseline markers");
  assert(rows.every(row=>Math.abs(row.comparisons.roundCss.deltaCentroid)<=.75),"CSS paint snapping must satisfy the unchanged centroid threshold");
  assert(rows.every(row=>["deltaTop","deltaBottom"].every(edge=>Math.abs(row.comparisons.roundCss[edge])<=(row.dpr*row.zoom>=2?2:1))),"CSS paint snapping must satisfy the unchanged ink-edge thresholds");
  t.diagnostic(JSON.stringify({output,fonts,groups,samples:rows.length,summary}));
});

test("Blink multiline paint origins include the measured 1/64 CSS line-height accumulation", async t => {
  const output=resolve(process.env.DESIGN_TEXT_ORIGIN_EVIDENCE ?? ".tmp/render-fidelity-r002/spike");
  await mkdir(output,{recursive:true});
  const font=await readFile(new URL("../../../apps/design-studio/app/fonts/InterVariable.woff2",import.meta.url));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const rows=[],negativeOrigins=[],fontObservations=[];
  for(const [dpr,zoom] of [[1,1],[2,1],[1,2],[2,2]]) {
    const page=await browser.newPage({viewport:{width:900,height:950},deviceScaleFactor:dpr});
    await page.route("**/*",route=>route.abort());
    await page.setContent(`<style>@font-face{font-family:FidelityInter;src:url(data:font/woff2;base64,${font.toString("base64")})}body{margin:0;background:white}main{position:absolute;inset:0;transform-origin:0 0;transform:scale(${zoom})}.probe{position:absolute;white-space:pre}</style><main></main>`);
    const interFaces = await loadInterProbeFont(page, 13);
    const group = await fontGroups(page); fontObservations.push({ dpr, zoom, interFaces, ...group });
    negativeOrigins.push(...await page.evaluate(zoom=>[-20.499,-20.501,-.499,.499,.501,20.499].map(y=>{
      const div=document.createElement("div");div.style.cssText=`position:absolute;top:${y}px;font:13px/20.8px system-ui`;div.textContent="Hg";
      const marker=document.createElement("span");marker.style.cssText="display:inline-block;width:0;height:0";div.append(marker);document.querySelector("main").append(div);
      const row={y,top:div.getBoundingClientRect().top/zoom,baseline:marker.getBoundingClientRect().top/zoom};div.remove();return row;
    }),zoom));
    for(const phase of [0,.25,.499,.5,.75]) for(const lineHeight of [13.2,17.6,20.8]) {
      const probes=await page.evaluate(({phase,lineHeight,zoom,families,probeFamilies})=>{
        const main=document.querySelector("main");main.replaceChildren();
        return families.map(family=>{
          const index = probeFamilies.indexOf(family); // Keep every retained probe at its original screenshot position.
          const y=20+index*145+phase,fontSize=13,cssFamily=family==="system-ui"?family:`"${family}"`;
          const ctx=document.createElement("canvas").getContext("2d");ctx.font=`400 ${fontSize}px ${cssFamily}`;
          const metrics=ctx.measureText("Hgx"),offset=Math.floor((lineHeight+Math.round(metrics.fontBoundingBoxAscent)-Math.round(metrics.fontBoundingBoxDescent))/2);
          const div=document.createElement("div");div.className="probe";div.style.cssText=`left:20px;top:${y}px;font:400 ${fontSize}px/${lineHeight}px ${cssFamily}`;
          const markers=Array.from({length:6},(_,i)=>{div.append(document.createTextNode("Hgx中"));const marker=document.createElement("span");marker.style.cssText="display:inline-block;width:0;height:0";div.append(marker);if(i<5)div.append(document.createElement("br"));return marker;});main.append(div);
          for(const [column,candidate] of ["roundCss","roundLayout","roundDom"].entries()){
            const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.classList.add("probe");svg.style.cssText=`left:${120+column*100}px;top:0;width:95px;height:470px;overflow:visible`;
            svg.innerHTML=markers.map((marker,i)=>{const baseline=candidate==="roundDom"?marker.getBoundingClientRect().top/zoom:candidate==="roundLayout"?Math.trunc(y*64)/64+i*Math.round(lineHeight*64)/64+offset:y+i*lineHeight+offset;return `<text x="0" y="${Math.round(baseline)}" font-family="${family}" font-size="${fontSize}">Hgx中</text>`;}).join("");main.append(svg);
          }
          return {family,y,fontSize,offset,top:div.getBoundingClientRect().top/zoom,baselines:markers.map(marker=>marker.getBoundingClientRect().top/zoom)};
        });
      },{phase,lineHeight,zoom,families:group.families,probeFamilies});
      const png=PNG.sync.read(await page.screenshot({path:resolve(output,`multiline-lh${lineHeight}-phase${phase}-dpr${dpr}-scale${zoom}.png`)})),scale=dpr*zoom;
      for(const probe of probes)for(let line=0;line<6;line++){
        const y=(probe.baselines[line]-probe.fontSize)*scale,height=lineHeight*scale,html=ink(png,20*scale,y,80*scale,height),comparisons={};
        for(const [column,candidate]of["roundCss","roundLayout","roundDom"].entries()){
          const actual=ink(png,(120+column*100)*scale,y,80*scale,height);comparisons[candidate]={...actual,deltaCentroid:actual.centroid-html.centroid,deltaTop:actual.top-html.top,deltaBottom:actual.bottom-html.bottom,deltaMass:actual.mass-html.mass};
        }
        rows.push({family:probe.family,fontSize:probe.fontSize,lineHeight,phase,line,dpr,zoom,authoredY:probe.y,domTop:probe.top,domBaseline:probe.baselines[line],formulaBaseline:probe.y+line*lineHeight+probe.offset,alphabeticOffset:probe.offset,layoutBaseline:Math.trunc(probe.y*64)/64+line*Math.round(lineHeight*64)/64+probe.offset,html,comparisons});
      }
    }
    await page.close();
  }
  const baselineFailures=rows.filter(row=>textLineBoxBaselineY({y:row.authoredY,fontSize:row.fontSize,lineHeight:row.lineHeight,lineHeightUnit:"pixels"},row.line,row.alphabeticOffset)!==Math.round(row.domBaseline));
  const summary=Object.fromEntries(["roundCss","roundLayout","roundDom"].map(candidate=>[candidate,{maxAbsCentroid:Math.max(...rows.map(row=>Math.abs(row.comparisons[candidate].deltaCentroid))),nonzeroCentroid:rows.filter(row=>Math.abs(row.comparisons[candidate].deltaCentroid)>.01).length}]));
  const groups = groupSampleCounts(rows, 360, fontObservations[0].pingFang);
  await writeFile(resolve(output,"multiline-metrics.json"),JSON.stringify({samples:rows.length,fontObservations,groups,negativeOrigins,baselineFailures,summary,rows},null,2));
  assert.equal(rows.length,720 + (fontObservations[0].pingFang.available ? 360 : 0));
  assert(negativeOrigins.every(row=>row.top===Math.trunc(row.y*64)/64),"negative layout origins must use the measured truncation direction");
  assert.deepEqual(baselineFailures,[],"shared paint baseline must match observed DOM inline baseline snapping");
  assert(rows.some(row=>Math.abs(row.comparisons.roundCss.deltaCentroid)>.75),"unquantized multiline sum must retain a detected regression");
  assert(rows.every(row=>Math.abs(row.comparisons.roundLayout.deltaCentroid)<=.75),"shared snapped origins must satisfy the unchanged centroid threshold");
  assert(rows.every(row=>["deltaTop","deltaBottom"].every(edge=>Math.abs(row.comparisons.roundLayout[edge])<=(row.dpr*row.zoom>=2?2:1))),"shared snapped origins must satisfy the unchanged ink-edge thresholds");
  t.diagnostic(JSON.stringify({output,groups,samples:rows.length,summary}));
});

test("a late loaded font replaces fallback line-box metrics and imported offset caches", async t => {
  const output=resolve(process.env.DESIGN_TEXT_ORIGIN_EVIDENCE ?? ".tmp/render-fidelity-r002/spike");
  await mkdir(output,{recursive:true});
  const root=resolve("apps/design-studio/app"),origin="https://text-line-box.test";
  const font=await readFile(resolve(root,"fonts/InterVariable.woff2"));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.route("**/*",async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin)return route.abort();
    if(url.pathname==="/")return route.fulfill({contentType:"text/html",body:"<!doctype html><body></body>"});
    const path=resolve(root,`.${url.pathname}`);
    if(!path.startsWith(`${root}/`)||!path.endsWith(".mjs"))return route.abort();
    const baseline=process.env.DESIGN_TEXT_METRICS_BASELINE_FILE;
    return route.fulfill({contentType:"text/javascript",body:await readFile(url.pathname==="/text-metrics.mjs"&&baseline?baseline:path)});
  });
  await page.goto(origin);
  const result=await page.evaluate(async encoded=>{
    const {createBrowserTextMeasurer}=await import("/text-metrics.mjs");
    const node={id:"late",type:"text",text:"Hgx",x:10,y:20,width:100,height:50,fontFamily:"LateFidelityFont",fontSize:13,fontWeight:400,lineHeight:1.6};
    const measurer=createBrowserTextMeasurer();
    const read=instance=>{instance.configure(node);return {baseline:instance.measure("Hgx").alphabeticBaseline,offset:instance.lineBoxOffset(node)};};
    const before=read(measurer);
    const face=new FontFace("LateFidelityFont",Uint8Array.from(atob(encoded),value=>value.charCodeAt(0)));
    document.fonts.add(face);await face.load();await document.fonts.ready;
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const after=read(measurer),fresh=createBrowserTextMeasurer(),expected=read(fresh);
    measurer.close();fresh.close();
    return {before,after,expected,status:face.status};
  },font.toString("base64"));
  await writeFile(resolve(output,"late-font-metrics.json"),JSON.stringify(result,null,2));
  assert.equal(result.status,"loaded");
  assert.notDeepEqual(result.before,result.expected,"the fixture must detect a real fallback-font geometry change");
  assert.deepEqual(result.after,result.expected,"the reused measurer must not retain fallback metrics after font load");
});
