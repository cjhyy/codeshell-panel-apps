import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { PNG } from "pngjs";
import { chromium } from "playwright";

test("CPU SVG preserves paint/link shaping and explicitly refuses unproved custom underline geometry",async(t)=>{
  const browser=await chromium.launch({args:["--disable-gpu"]});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:400,height:180},deviceScaleFactor:1}),page=await context.newPage(),root=resolve("apps/design-studio/app");
  const font=await readFile(resolve(root,"fonts/InterVariable.woff2")),fontCss=`@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font.toString("base64")});font-weight:100 900;font-display:block}`;
  const blocked=[];
  await context.route("**/*",async route=>{
    const url=new URL(route.request().url()),file=resolve(root,"."+url.pathname);
    if(url.href==="https://ranges-svg.test/")return route.fulfill({contentType:"text/html",body:`<style>${fontCss}body{margin:0}</style>`});
    if(url.origin==="https://ranges-svg.test"&&file.startsWith(root+sep)&&file.endsWith(".mjs"))return route.fulfill({contentType:"text/javascript",body:await readFile(file)});
    blocked.push(url.href);return route.abort();
  });
  await page.goto("https://ranges-svg.test/");
  const cases=await page.evaluate(async({fontCss})=>{
    const {normalizeDesignDocument,exportDesignSvg,serializeDesignDocument}=await import("/document.mjs"),{createBrowserTextMeasurer,measuredWrap}=await import("/text-metrics.mjs"),{textRangeSourceSignature,replaceTextRange}=await import("/text-ranges.mjs");
    await document.fonts.load("400 20px Inter");
    const initial="AV link gyp_ tail\nExplicit \u00a0 space",start=3,end=12, records=[];
    const base={id:"copy",type:"text",name:"Copy",x:20,y:20,width:300,height:100,fill:"#0b0c0c",stroke:"transparent",strokeWidth:0,opacity:1,rotation:0,cornerRadius:0,visible:true,locked:false,text:initial,textSource:initial,textFlow:"wrap",fontFamily:"Inter",fontSize:20,fontWeight:400,lineHeight:1.25,textAlign:"left"};
    const measurement=createBrowserTextMeasurer();
    try{for(const underline of [false,true])for(const width of [300,140]){
      let node={...base,width,textRanges:{version:1,sourceSignature:textRangeSourceSignature(initial),ranges:[{start,end,fill:"#1a65a6",href:"#",...(underline?{textDecoration:"underline",textDecorationThickness:{unit:"px",value:1},textUnderlineOffset:{unit:"em",value:.1578},textDecorationSkipInk:"auto"}:{})}]}};
      for(const editing of [false,true]){
        if(editing)node=replaceTextRange(node,{start:3,end:7,text:"new link",affinity:"after",expectedSourceSignature:node.textRanges.sourceSignature});
        measurement.configure(node);node.y=20+measurement.lineBoxOffset(node);node.text=measuredWrap(node.textSource,width,value=>measurement.measure(value)).join("\n");
        const doc={format:"codeshell.design",version:3,name:"Ranges",canvas:{width:400,height:180,background:"#ffffff"},tokens:{colors:[]},activePageId:"main",pages:[{id:"main",name:"Main",children:[node]}]},state=normalizeDesignDocument(doc),saved=serializeDesignDocument(state),reopened=normalizeDesignDocument(JSON.parse(saved));
        const range=node.textRanges.ranges[0],escape=value=>value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
        const text=node.textSource,reference=`<!doctype html><style>${fontCss}body{margin:0;background:#fff}p{position:absolute;left:20px;top:20px;width:${width}px;margin:0;font:400 20px/25px Inter;white-space:pre-wrap;color:#0b0c0c}a{color:#1a65a6;text-decoration:${underline?"underline":"none"};text-decoration-thickness:1px;text-underline-offset:.1578em;text-decoration-skip-ink:auto}</style><p>${escape(text.slice(0,range.start))}<a href="#">${escape(text.slice(range.start,range.end))}</a>${escape(text.slice(range.end))}</p>`;
        let svg,unsupportedCode;try{svg=exportDesignSvg(reopened);}catch(error){unsupportedCode=error.code;}
        records.push({underline,width,editing,reference,svg,unsupportedCode,source:reopened.nodes[0].textSource,range:reopened.nodes[0].textRanges});
      }
    }}finally{measurement.close();}
    return records;
  },{fontCss});
  const results=[];
  for(const [index,item] of cases.entries()){
    if(item.underline){assert.equal(item.unsupportedCode,"TEXT_RANGES_SVG_UNSUPPORTED_DECORATION");assert.equal(item.svg,undefined);continue;}
    assert.equal(item.unsupportedCode,undefined);
    await page.setContent(item.reference);await page.evaluate(()=>document.fonts.ready);const expectedBytes=await page.screenshot(),expected=PNG.sync.read(expectedBytes);
    const styles=()=>[...document.querySelectorAll("p,a,text,tspan")].map(e=>({tag:e.tagName,text:e.textContent,style:Object.fromEntries(["color","fill","text-decoration-line","text-decoration-color","text-decoration-thickness","text-underline-offset","text-decoration-skip-ink"].map(k=>[k,getComputedStyle(e).getPropertyValue(k)]))}));
    const referenceStyles=await page.evaluate(styles);
    await page.setContent(`<!doctype html><style>${fontCss}body{margin:0}svg{display:block}</style>${item.svg}`);await page.evaluate(()=>document.fonts.ready);const actualBytes=await page.screenshot(),actual=PNG.sync.read(actualBytes),actualStyles=await page.evaluate(styles);
    let changed=0,max=0;const rows={},coordinates=[];for(let i=0;i<actual.data.length;i+=4){let different=false;for(let c=0;c<4;c++){const delta=Math.abs(actual.data[i+c]-expected.data[i+c]);max=Math.max(max,delta);different||=delta!==0;}if(different){changed++;const x=(i/4)%actual.width,y=Math.floor(i/4/actual.width);rows[y]=(rows[y]??0)+1;if(coordinates.length<50)coordinates.push({x,y,expected:[...expected.data.subarray(i,i+4)],actual:[...actual.data.subarray(i,i+4)]});}}
    const result={underline:item.underline,width:item.width,editing:item.editing,changed,max,rows,coordinates,referenceStyles,actualStyles};results.push(result);
    if(process.env.CODESHELL_RANGE_EVIDENCE){const dir=resolve(process.env.CODESHELL_RANGE_EVIDENCE,String(index));await mkdir(dir,{recursive:true});for(const [name,data] of [["source.html",item.reference],["actual.svg",item.svg],["source.png",expectedBytes],["actual.png",actualBytes],["comparison.json",JSON.stringify(result,null,2)+"\n"]])await writeFile(resolve(dir,name),data,{flag:"wx"});}
    assert(!item.svg.includes('text-decoration="underline"'),"base decoration must not propagate past range none");
    assert(item.svg.includes('href="#"'));assert(item.svg.includes("<tspan"));
  }
  assert.equal(results.filter(x=>x.changed).length,0,JSON.stringify(results.map(({underline,width,editing,changed,max})=>({underline,width,editing,changed,max}))));
  assert.deepEqual(blocked,[]);
});
