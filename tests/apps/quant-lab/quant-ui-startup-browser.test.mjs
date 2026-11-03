// Actual browser counterpart to the minimal-DOM controller measurement. No
// provider, credentials, user's HOME or installed application is consulted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';
const root=fileURLToPath(new URL('../../../apps/quant-lab/app/',import.meta.url));
function fixture(){
 const instruments=Array.from({length:20},(_,i)=>({id:`cn-${i}`,type:'stock',market:'cn',currency:'CNY',symbol:`SH${600000+i}`,name:`Fixture ${i}`,aliases:[]}));
 return JSON.stringify({format:'codeshell.portfolio-transactions',version:1,baseCurrency:'CNY',accounts:[{id:'cn',name:'Fixture',broker:'fixture',currencies:['CNY']}],instruments,
 transactions:Array.from({length:2000},(_,i)=>({id:`buy-${i}`,type:'buy',accountId:'cn',instrumentId:`cn-${i%20}`,tradeDate:'2026-10-27',quantity:'1',price:'10.00',commission:'0.00',tax:'0.00',otherFees:'0.00',createdAt:new Date(Date.UTC(2026,9,27,1,0,i)).toISOString()}))});
}
test('Chromium cold/hot context-to-base P95 with 50ms bridge and large project fixture',async t=>{
 const browser=await chromium.launch({headless:true});const source=fixture();const samples={cold:[],hot:[]};
 try{
  for(let cycle=0;cycle<10;cycle++){
   const context=await browser.newContext();
   await context.route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.origin!=='https://quant-performance.test')return route.abort();
    const name=decodeURIComponent(url.pathname).replace(/^\//u,'')||'index.html';if(name.includes('..'))return route.abort();
    try{await route.fulfill({body:await readFile(join(root,name)),contentType:({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json'})[extname(name)]??'application/octet-stream'});}catch{await route.fulfill({status:404,body:'Not found'});}
   });
   await context.addInitScript(({source})=>{
    window.__calls=[];window.__quantLabNow='2026-10-28T02:00:00Z';const delay=()=>new Promise(resolve=>setTimeout(resolve,50));
    const context={cwd:'/fixture/project',trusted:true,visible:true,availableMethods:['storage.get','storage.getSnapshot','storage.compareAndSet','workspace.list','workspace.readText']};
    window.codeshellPanel={on(){return()=>{};},registerTool(){},async getContext(){await delay();performance.mark('fixture:context');return context;},async call(method,params){window.__calls.push({method,params});await delay();
     if(method==='storage.get')return params.key.startsWith('activeTab.')?'holdings':null;
     if(method==='storage.getSnapshot')return{exists:false,value:null,revision:null};
     if(method==='storage.compareAndSet')return{updated:true,snapshot:{exists:true,value:params.value,revision:'sha256:'+'a'.repeat(64)}};
     if(method==='workspace.list')return{entries:params.path==='portfolio'?[{kind:'file',path:'portfolio/transactions.json'}]:params.path==='data/market'?Array.from({length:250},(_,i)=>({kind:'file',path:`data/market/${i}.meta.json` })):[]};
     if(method==='workspace.readText'&&params.path==='portfolio/transactions.json')return{content:source,revision:'fixture-1'};
     throw Error(`Unexpected ${method}`);
    }};
   },{source});
   const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
   for(const mode of ['cold','hot']){
    await page.goto('https://quant-performance.test/index.html');
    await page.waitForFunction(()=>performance.getEntriesByName('quant-lab:portfolioBaseReady').length===1);
    const measured=await page.evaluate(()=>({duration:performance.getEntriesByName('quant-lab:portfolioBaseReady')[0].startTime-performance.getEntriesByName('fixture:context')[0].startTime,calls:window.__calls}));
    samples[mode].push(measured.duration);assert.equal(await page.locator('.portfolio-position').count(),20);
    assert.equal(measured.calls.some(call=>call.method==='process.spawn'),false);
    assert.equal(measured.calls.some(call=>call.method==='workspace.list'&&call.params.path==='data/market'),false);
   }
   assert.deepEqual(errors,[]);await context.close();
  }
  const p95=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
  const result={bridgeDelayMs:50,holdings:20,transactions:2000,metadata:250,coldP95Ms:p95(samples.cold),hotP95Ms:p95(samples.hot),samples};
  t.diagnostic(JSON.stringify(result));assert.ok(result.coldP95Ms<=1000);assert.ok(result.hotP95Ms<=1000);
 }finally{await browser.close();}
});
