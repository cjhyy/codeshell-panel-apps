import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createHoldingsController } from '../../../apps/quant-lab/app/modules/holdings-ui.mjs';
import { createHoldingsSnapshotCache, deriveHoldingsSnapshot } from '../../../apps/quant-lab/app/portfolio-store.mjs';
import { createPanelBootstrap } from '../../../apps/quant-lab/app/modules/panel-bootstrap.mjs';

class Element {
  constructor(){this.children=[];this.dataset={};this.style={};this.value='';this.textContent='';this.listeners=new Map();this.hidden=false;}
  append(...nodes){for(const n of nodes){n.parent?.removeChild(n);n.parent=this;this.children.push(n);}}
  removeChild(node){this.children=this.children.filter(n=>n!==node);node.parent=null;}
  remove(){this.parent?.removeChild(this);}
  replaceChildren(...nodes){for(const n of this.children)n.parent=null;this.children=[];this.append(...nodes);}
  querySelectorAll(){return [];}
  addEventListener(name,fn){this.listeners.set(name,fn);}
  setAttribute(){} focus(){} scrollIntoView(){}
}
function fixture(){
 const instruments=Array.from({length:20},(_,i)=>({id:`cn-${i}`,type:'stock',market:'cn',currency:'CNY',symbol:`SH${600000+i}`,name:`股票${i}`,aliases:[]}));
 return {format:'codeshell.portfolio-transactions',version:1,baseCurrency:'CNY',accounts:[{id:'cn',name:'Fixture',broker:'fixture',currencies:['CNY']}],instruments,
 transactions:Array.from({length:2000},(_,i)=>({id:`buy-${i}`,type:'buy',accountId:'cn',instrumentId:`cn-${i%20}`,tradeDate:'2026-10-27',quantity:'1',price:'10.00',commission:'0.00',tax:'0.00',otherFees:'0.00',createdAt:new Date(Date.UTC(2026,9,27,1,0,i)).toISOString()}))};
}
const instant='2026-10-28T02:00:00Z';

test('real holdings controller cold/hot base path reads only ledger with 50ms bridge, 20 holdings/2000 trades/250 irrelevant metadata', async t=>{
 const original=globalThis.document; globalThis.document={createElement:()=>new Element(),createTextNode:text=>Object.assign(new Element(),{textContent:text}),querySelector:()=>null};
 const ledger=JSON.stringify(fixture()); const cold=[],hot=[];let last;
 try{
  for(let run=0;run<10;run++){
   const calls=[];const elements=new Proxy({performance:null},{get:(obj,key)=>key in obj?obj[key]:(obj[key]=new Element())});
   let epoch=1;
   const hostCall=async(method,params)=>{calls.push({method,params});await new Promise(r=>setTimeout(r,50));
    if(method==='storage.get')return 'holdings';
    if(method==='workspace.list')return {entries:params.path==='portfolio'?[{kind:'file',path:'portfolio/transactions.json'}]:Array.from({length:250},(_,i)=>({kind:'file',path:`data/market/${i}.meta.json`}))};
    if(method==='workspace.readText'&&params.path==='portfolio/transactions.json')return{content:ledger,revision:'ledger-1'};
    throw Error(`unexpected ${method}:${params.path}`);};
   const controller=createHoldingsController({elements,hostCall,currentEpoch:()=>epoch,now:()=>new Date(instant)});
   const gate=createPanelBootstrap({currentEpoch:()=>epoch});
   const start=performance.now();const active=await hostCall('storage.get',{key:'activeTab'});gate.open(epoch);await gate.ensure(active,()=>controller.loadBase(epoch));
   cold.push(performance.now()-start);
   assert.equal(elements.holdingsList.children.length,20);assert.equal(controller.noteContext().holdings.positionsByAccount[0].quantity,'100');
   assert.deepEqual(controller.noteContext().unavailableSources,{ledger:false,rules:true},'cold base makes ledger links available without claiming historical rule results');
   assert.equal(calls.filter(c=>c.method==='workspace.readText').length,1);
   assert.deepEqual(calls.filter(c=>c.method==='workspace.list').map(c=>c.params.path),['portfolio']);
   assert.equal(calls.some(c=>c.method==='process.spawn'),false);
   const startHot=performance.now();await controller.loadBase(epoch);hot.push(performance.now()-startHot);
   assert.match(elements.baseState.textContent,/待详情/u); assert.equal(elements.transactionsList.children.length,101);
   const rows=[...elements.holdingsList.children]; controller.refreshRules(); assert.deepEqual(elements.holdingsList.children,rows);
   last=controller;controller.reset();
  }
  const p95=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
  t.diagnostic(JSON.stringify({environment:'Node real controller + minimal DOM, not browser paint',bridgeDelayMs:50,holdings:20,transactions:2000,metadata:250,coldRuns:10,hotRuns:10,coldP95Ms:p95(cold),hotP95Ms:p95(hot)}));
  assert.ok(p95(cold)<1000,`controller base P95 ${p95(cold)}`);
 }finally{last?.reset();globalThis.document=original;}
});

test('semantic ledger and transaction FX control replay while ending FX only revalues',()=>{
 const ledger={format:'codeshell.portfolio-transactions',version:1,baseCurrency:'CNY',accounts:[{id:'us',name:'Fixture',broker:'fixture',currencies:['USD']}],
  instruments:[{id:'aapl',type:'stock',market:'us',currency:'USD',symbol:'AAPL',name:'Apple',aliases:[]}],
  transactions:[{id:'buy',type:'buy',accountId:'us',instrumentId:'aapl',tradeDate:'2026-10-26',quantity:'1',price:'10.00',commission:'0.00',tax:'0.00',otherFees:'0.00',createdAt:'2026-10-26T15:00:00Z'}]};
 const source=JSON.stringify(ledger),cache=createHoldingsSnapshotCache();
 const inputs={endingDate:'2026-10-28',endingPrices:{aapl:'12'},checkpointFx:{'2026-10-27':{USD:'7'},'2026-10-28':{USD:'7.2'}}};
 performance.clearMarks('quant-lab:replayHoldings'); const marks=()=>performance.getEntriesByName('quant-lab:replayHoldings').length;
 assert.deepEqual(cache.derive(source,inputs,instant),deriveHoldingsSnapshot(source,inputs,instant));assert.equal(marks(),1);
 const ending={...inputs,checkpointFx:{...inputs.checkpointFx,'2026-10-28':{USD:'7.3'}}};
 assert.deepEqual(cache.derive(JSON.stringify(ledger,null,2)+'\n',ending,instant),deriveHoldingsSnapshot(JSON.stringify(ledger,null,2)+'\n',ending,instant));assert.equal(marks(),1,'text formatting and ending FX never replay');
 const history={...ending,checkpointFx:{...ending.checkpointFx,'2026-10-27':{USD:'7.1'}}};
 assert.deepEqual(cache.derive(source,history,instant),deriveHoldingsSnapshot(source,history,instant));assert.equal(marks(),2,'transaction checkpoint FX invalidates');
 ledger.transactions[0].price='10.01';cache.derive(JSON.stringify(ledger),history,instant);assert.equal(marks(),3,'semantic ledger edit invalidates');
});

test('confirmed missing ledger and an unsaved create-form draft have distinct note-reference availability',async()=>{
 const original=globalThis.document;globalThis.document={createElement:()=>new Element(),querySelector:()=>null};
 const elements=new Proxy({performance:null},{get:(obj,key)=>key in obj?obj[key]:(obj[key]=new Element())});let controller;
 try{
  controller=createHoldingsController({elements,currentEpoch:()=>1,hostCall:async(method)=>{assert.equal(method,'workspace.list');return{entries:[]};}});
  await controller.loadBase();assert.equal(controller.noteContext().ledger,null);assert.equal(controller.noteContext().unavailableSources.ledger,false,'the local file was confirmed absent');
  controller.openEntry();assert.notEqual(controller.noteContext().ledger,null);assert.equal(controller.noteContext().unavailableSources.ledger,true,'an unsaved empty form must not override authoritative Notes references');
 }finally{controller?.reset();globalThis.document=original;}
});

test('real holdings DOM retains keyed rows, accepts unknown sessions and same-value ticks replay zero transactions',async()=>{
 const original={document:globalThis.document,requestAnimationFrame:globalThis.requestAnimationFrame};
 globalThis.document={createElement:()=>new Element(),createTextNode:text=>Object.assign(new Element(),{textContent:text}),querySelector:()=>null};
 globalThis.requestAnimationFrame=fn=>{queueMicrotask(fn);return 1;};
 const source=JSON.stringify(fixture()),events=new Map(),configured=[];let seq=1;
 const quote={market:'cn',symbol:'SH600000',currency:'CNY',price:'12',asOf:instant,marketDate:'2026-10-28',session:'unknown',priceBasis:'raw',previousClose:'11',referenceDate:'2026-10-28',referenceBasis:'supplier-session-reference',dayChange:'1',dayChangePct:'9.09090909',source:'fixture',fetchedAt:instant,status:'ok',reason:null};
 const doc={format:'quant.quotes/2',items:{'cn:SH600000':quote}};
 const context={availableMethods:['get','read','attach','detach','configure','control','setDesired'].map(n=>`services.${n}`),capabilities:{services:{version:1}}};
 const elements=new Proxy({performance:null},{get:(obj,key)=>key in obj?obj[key]:(obj[key]=new Element())});
 const hostCall=async(method,params)=>{
  if(method==='workspace.list')return{entries:params.path==='portfolio'?[{kind:'file',path:'portfolio/transactions.json'}]:[]};
  if(method==='workspace.readText')return{content:source,revision:'ledger'};
  if(method==='services.get')return{desired:'always',desiredRevision:1,configRevision:0,phase:'running'};
  if(method==='services.read')return{seq,generation:1,value:structuredClone(doc)};
  if(method==='services.attach')return{attachId:'one'};
  if(method==='services.configure'){configured.push(params.config);return{};}
  if(method==='services.control'||method==='services.detach')return{};
  throw Error(method);
 };
 let controller;
 try{
  controller=createHoldingsController({elements,hostCall,getContext:()=>context,onHostEvent:(name,fn)=>{events.set(name,fn);return()=>events.delete(name);},currentEpoch:()=>1,now:()=>new Date(instant),
   additionalQuoteSymbols:()=>[{market:'us',symbol:'0700.HK'},{market:'us',symbol:'BRK:B'},{market:'us',symbol:'BRK.B'}]});
  await controller.loadBase();await controller.ensureDetails();controller.setActive(true);await controller.refreshQuotes();await new Promise(setImmediate);
  assert.equal(configured.at(-1).subscriptions.length,21,'held symbols and a supported watch entry remain subscribed');
  assert.ok(configured.at(-1).subscriptions.some(item=>item.symbol==='BRK.B'));
  assert.ok(configured.at(-1).subscriptions.every(item=>!['0700.HK','BRK:B'].includes(item.symbol)),'invalid watch symbols never enter either quote mode');
  assert.deepEqual(controller.noteContext().unavailableSources,{ledger:false,rules:false});
  const row=elements.holdingsList.children.find(item=>item.dataset.symbol==='SH600000');
  const details=row.children.find(item=>item.dataset.patchKey==='provenance');details.open=true;
  const button=row.children.find(item=>item.dataset.patchKey==='record-note');globalThis.document.activeElement=button;
  assert.ok(row);const marks=()=>performance.getEntriesByName('quant-lab:replayHoldings').length;const before=marks();
  doc.items['cn:SH600000']={...quote,fetchedAt:'2026-10-28T02:00:15Z'};
  seq++;events.get('services.changed')({name:'market-feed',channel:'quotes',seq});await new Promise(setImmediate);
  assert.equal(marks(),before);assert.equal(elements.holdingsList.children.find(item=>item.dataset.symbol==='SH600000'),row);
  assert.equal(row.children.find(item=>item.dataset.patchKey==='provenance'),details);assert.equal(details.open,true);assert.equal(globalThis.document.activeElement,button);
  doc.items['cn:SH600000']={...quote,price:'13',dayChange:'2',dayChangePct:'18.18181818'};seq++;events.get('services.changed')({name:'market-feed',channel:'quotes',seq});await new Promise(setImmediate);
  assert.equal(marks(),before,'new ending price revalues without replay');assert.equal(elements.holdingsList.children.find(item=>item.dataset.symbol==='SH600000'),row);
  assert.equal(row.children.find(item=>item.dataset.patchKey==='provenance'),details);assert.equal(details.open,true);assert.equal(row.children.find(item=>item.dataset.patchKey==='record-note'),button);
  const labels=row.children.find(item=>item.className==='portfolio-position-metrics').children;
  assert.equal(labels.find(item=>item.children[0].textContent==='日涨跌 · 本币').children[1].textContent,'2 CNY');
  doc.items['cn:SH600000']={...quote,price:'11',dayChange:'0',dayChangePct:'0'};seq++;events.get('services.changed')({name:'market-feed',channel:'quotes',seq});await new Promise(setImmediate);
  const zero=row.children.find(item=>item.className==='portfolio-position-metrics').children.find(item=>item.children[0].textContent==='日涨跌 · 本币').children[1];
  assert.equal(zero.textContent,'0 CNY');assert.ok(!zero.dataset.tone || zero.dataset.tone==='neutral','flat price is neutral in the actual tone attribute');
 }finally{controller?.reset();globalThis.document=original.document;globalThis.requestAnimationFrame=original.requestAnimationFrame;}
});


test('base and details use abortable owned requests and execution identity fences late results', async()=>{
 const original=globalThis.document;globalThis.document={createElement:()=>new Element(),createTextNode:text=>Object.assign(new Element(),{textContent:text}),querySelector:()=>null};
 let executionId='one',release,entered;const ready=new Promise(resolve=>entered=resolve),barrier=new Promise(resolve=>release=resolve);const calls=[];
 const elements=new Proxy({performance:null},{get:(obj,key)=>key in obj?obj[key]:(obj[key]=new Element())});let controller;
 try{
  controller=createHoldingsController({elements,currentEpoch:()=>1,getContext:()=>({executionId}),now:()=>new Date(instant),hostCall:async(method,params,intent)=>{
   calls.push({method,params,intent});if(method==='workspace.list'&&params.path==='portfolio')return{entries:[{kind:'file',path:'portfolio/transactions.json'}]};
   if(method==='workspace.readText')return{content:JSON.stringify(fixture())};
   if(method==='workspace.list'){entered();await barrier;return{entries:[]};}throw Error(method);
  }});
  await controller.loadBase();const details=controller.ensureDetails();await ready;
  const request=calls.find(call=>call.intent?.owner==='portfolio-details');assert.ok(request.intent.signal);assert.equal(request.intent.signal.aborted,false);
  executionId='two';controller.reset();assert.equal(request.intent.signal.aborted,true);release();await details;
  await controller.loadBase();assert.equal(calls.filter(call=>call.params.path==='portfolio'&&call.intent.owner==='portfolio-base').length,2);assert.match(elements.baseState.textContent,/待详情/u);
  assert.ok(calls.filter(call=>call.params.path==='portfolio').every(call=>['portfolio-base','portfolio-details'].includes(call.intent.owner)&&call.intent.signal));
 }finally{controller?.reset();globalThis.document=original;}
});

function smallUsdLedger() {
 return {format:'codeshell.portfolio-transactions',version:1,baseCurrency:'CNY',accounts:[{id:'us',name:'Fixture',broker:'fixture',currencies:['USD']}],
  instruments:[{id:'aapl',type:'stock',market:'us',currency:'USD',symbol:'AAPL',name:'Apple',aliases:[]}],
  transactions:[{id:'buy',type:'buy',accountId:'us',instrumentId:'aapl',tradeDate:'2026-10-26',quantity:'2',price:'10.00',commission:'0.00',tax:'0.00',otherFees:'0.00',createdAt:'2026-10-26T15:00:00Z'}]};
}
const deferred = () => { let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve}; };
const nodeText = node => [node.textContent,...node.children.map(nodeText)].join(' ');

test('details inspect the actual holdings cache in the background; missing, corrupt, stale and matching states remain distinguishable',async()=>{
 const original=globalThis.document;globalThis.document={createElement:()=>new Element(),createTextNode:text=>Object.assign(new Element(),{textContent:text}),querySelector:()=>null};
 const ledger=smallUsdLedger(),source=JSON.stringify(ledger),old=structuredClone(ledger);old.transactions[0].price='9.00';
 const stored=JSON.stringify(deriveHoldingsSnapshot(source,{},instant)),stale=JSON.stringify(deriveHoldingsSnapshot(JSON.stringify(old),{},instant));
 try{
  for(const [content,status,reason] of [[null,'unavailable','holdings-cache-not-found'],['{','unavailable','holdings-cache-invalid'],[stale,'warning',null],[stored,'positive',null]]){
   const elements=new Proxy({performance:null},{get:(obj,key)=>key in obj?obj[key]:(obj[key]=new Element())}),calls=[],states=[];
   const entered=deferred(),release=deferred();let controller;
   try{
    controller=createHoldingsController({elements,currentEpoch:()=>1,now:()=>new Date(instant),onViewState:state=>states.push(state),hostCall:async(method,params,intent)=>{
     calls.push({method,params,intent});
     if(method==='workspace.list'&&params.path==='portfolio'){
      if(intent.owner==='portfolio-details'){entered.resolve();await release.promise;}
      return{entries:[{kind:'file',path:'portfolio/transactions.json'},...(content===null?[]:[{kind:'file',path:'portfolio/holdings.json'}])]};
     }
     if(method==='workspace.readText')return{content:params.path==='portfolio/transactions.json'?source:content};
     if(method==='workspace.list')return{entries:[]};throw Error(method);
    }});
    await controller.loadBase();assert.equal(calls.length,2,'base reads only the authoritative ledger');
    assert.equal(controller.noteContext().unavailableSources.rules,true);assert.deepEqual(controller.noteContext().rules,[]);
    const details=controller.ensureDetails();await entered.promise;
    assert.match(elements.totalBase.textContent,/待详情/u);assert.equal(elements.totalBase.dataset.state,'pending');
    assert.match(elements.pnlBase.textContent,/待详情/u);assert.match(elements.fxSource.textContent,/待详情/u);
    assert.match(elements.summaryNote.textContent,/正在计算/u);
    assert.doesNotMatch([nodeText(elements.holdingsList),elements.summaryNote.textContent,elements.totalBase.textContent,elements.pnlBase.textContent,elements.fxSource.textContent].join(' '),/缺少汇率|暂无法计算|暂不可用/u,'base cannot diagnose FX before the details read');
    release.resolve();await details;
    const rule=controller.noteContext().rules.find(item=>item.id==='ledger-fingerprint-mismatch');
    assert.equal(rule.status,status);
    if(reason)assert.equal(rule.unavailable.reason,reason);
    if(status==='warning')assert.equal(rule.actual.equal,false);
    assert.deepEqual(states.at(-1).rules,controller.noteContext().rules,'Agent and Today receive the inspected rule result');
    assert.equal(controller.noteContext().unavailableSources.rules,false);
    assert.match(nodeText(elements.holdingsList),/缺少汇率/u,'after inspection actual missing FX remains visible');
    assert.equal(elements.totalBase.dataset.state,'unavailable');
    assert.ok(calls.filter(call=>call.intent.owner==='portfolio-details').every(call=>call.intent.priority==='background'&&call.intent.signal));
   }finally{release.resolve();controller?.reset();}
  }
 }finally{globalThis.document=original;}
});

test('a late holdings-cache inspection cannot publish into a replacement execution or ledger',async()=>{
 const original=globalThis.document;globalThis.document={createElement:()=>new Element(),createTextNode:text=>Object.assign(new Element(),{textContent:text}),querySelector:()=>null};
 const ledger=smallUsdLedger(),source=JSON.stringify(ledger),old=structuredClone(ledger);old.transactions[0].price='9.00';
 const stale=JSON.stringify(deriveHoldingsSnapshot(JSON.stringify(old),{},instant)),matching=JSON.stringify(deriveHoldingsSnapshot(source,{},instant));
 const entered=deferred(),release=deferred();let executionId='old',controller;const calls=[],states=[];
 const elements=new Proxy({performance:null},{get:(obj,key)=>key in obj?obj[key]:(obj[key]=new Element())});
 try{
  controller=createHoldingsController({elements,currentEpoch:()=>1,getContext:()=>({executionId}),now:()=>new Date(instant),onViewState:state=>states.push(state),hostCall:async(method,params,intent)=>{
   calls.push({method,params,intent});
   if(method==='workspace.list')return{entries:params.path==='portfolio'?[{kind:'file',path:'portfolio/transactions.json'},{kind:'file',path:'portfolio/holdings.json'}]:[]};
   if(params.path==='portfolio/transactions.json')return{content:source};
   if(params.path==='portfolio/holdings.json'){if(executionId==='old'){entered.resolve();await release.promise;return{content:stale};}return{content:matching};}
   throw Error(method);
  }});
  await controller.loadBase();const oldDetails=controller.ensureDetails();await entered.promise;
  const oldRead=calls.find(call=>call.params.path==='portfolio/holdings.json');
  executionId='new';controller.reset();assert.equal(oldRead.intent.signal.aborted,true);
  await controller.loadBase();await controller.ensureDetails();const latest=states.at(-1),count=states.length;
  assert.equal(latest.rules.find(item=>item.id==='ledger-fingerprint-mismatch').status,'positive');
  release.resolve();await oldDetails;assert.equal(states.length,count);assert.equal(states.at(-1),latest);
 }finally{release.resolve();controller?.reset();globalThis.document=original;}
});
