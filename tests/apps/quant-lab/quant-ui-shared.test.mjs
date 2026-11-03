import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createQuoteCasStore, createSharedMarketController, supportsMarketService } from '../../../apps/quant-lab/app/modules/market-service-client.mjs';
import { createPanelBootstrap } from '../../../apps/quant-lab/app/modules/panel-bootstrap.mjs';
import { createPanelHostCallScheduler } from '../../../apps/quant-lab/app/modules/panel-host-call-scheduler.mjs';
import { normalizeQuoteV2 } from '../../../apps/quant-lab/app/quote-contract.mjs';
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function storage() {
  let snapshot = { exists: false, value: null, revision: null };
  let lost = false, comparisons = 0;
  return { get comparisons(){return comparisons;}, get value() { return structuredClone(snapshot); }, lose() { lost = true; }, async call(method, input) {
    if (method === 'storage.getSnapshot') return structuredClone(snapshot);
    assert.equal(method, 'storage.compareAndSet'); comparisons++;
    if (snapshot.revision !== input.expectedRevision) return { updated: false, snapshot: structuredClone(snapshot) };
    snapshot = { exists: true, value: structuredClone(input.value), revision: `sha256:${createHash('sha256').update(JSON.stringify(input.value)).digest('hex')}` };
    if (lost) { lost = false; throw new Error('receipt lost'); }
    return { updated: true, snapshot: structuredClone(snapshot) };
  } };
}
const quote = normalizeQuoteV2({ market:'cn', symbol:'SH600036', price:'10', asOf:'2026-10-28T02:00:00Z', source:'fixture' }, { market:'cn', symbol:'SH600036', now:new Date('2026-10-28T02:00:00Z') });

test('one CAS fences delayed publication after takeover and stop, retaining monotonic tombstones', async () => {
  for (const action of ['takeover', 'stop']) {
    const store = storage(); let now = 0; const arrived = deferred(), release = deferred();
    const a = createQuoteCasStore({ hostCall:store.call, instanceId:'A', now:()=>0, leaseMs:10, hooks:{ beforePublish:async()=>{ arrived.resolve(); await release.promise; } } });
    const b = createQuoteCasStore({ hostCall:store.call, instanceId:'B', now:()=>now, leaseMs:10 });
    await a.acquire();
    assert.equal(await b.acquire(), null);
    const pending = a.publish({ quotes:[quote] }); await arrived.promise;
    if (action === 'takeover') { now=11; await b.acquire(); } else await b.stop('stop-1');
    const authoritative = store.value;
    const attempts=store.comparisons;release.resolve(); assert.equal(await pending, null);
    assert.equal(store.comparisons,attempts+1,"old owner still considers lease live and reaches the actual CAS rejection");
    assert.deepEqual(store.value, authoritative);
    assert.ok(store.value.value.generation >= 2);
  }
});

test('lost stop reply queries same receipt and unknown formats never write', async()=>{
  const store=storage(), owner=createQuoteCasStore({hostCall:store.call}); await owner.acquire();
  store.lose(); await owner.stop('lost'); const saved=store.value;
  await owner.stop('lost'); assert.deepEqual(store.value,saved);
  assert.equal(await owner.acquire(),null);
  let writes=0;
  const unknown=createQuoteCasStore({hostCall:async(method)=>{if(method==='storage.compareAndSet') writes++; return {exists:true,value:{format:'quant.quotes/99'},revision:'r'};}});
  await assert.rejects(unknown.acquire(),/格式/u); assert.equal(writes,0);
});

test('service snapshot is read before attach, same quote events do not replay or spawn',async()=>{
  const calls=[]; let listener; const doc={format:'quant.quotes/2',items:{'cn:SH600036':quote}}; let updates=0;
  const context={capabilities:{services:{version:1}},availableMethods:['get','read','attach','detach','configure','setDesired','control'].map(n=>`services.${n}`)};
  const controller=createSharedMarketController({getContext:()=>context,symbols:()=>[{market:'cn',symbol:'SH600036'}],request:{cancel(){},fetch(){throw Error('unexpected spawn');}},
    onHostEvent:(_,fn)=>{listener=fn;return()=>{};}, onUpdate:(_quotes,state)=>{ if (!state.preserve) updates++; }, schedule:()=>1,unschedule(){},
    hostCall:async(method)=>{calls.push(method); if(method==='services.get') return {desired:'always',desiredRevision:1,configRevision:1,phase:'running'}; if(method==='services.read')return {seq:1,generation:4,value:doc}; if(method==='services.attach')return{attachId:'attach'}; return{};}});
  controller.setActive(true); await controller.refresh();
  assert.ok(calls.indexOf('services.read')<calls.indexOf('services.attach')); assert.equal(updates,1);
  listener({name:'market-feed',channel:'quotes',seq:1}); await Promise.resolve(); await Promise.resolve(); assert.equal(updates,1);
  assert.equal(supportsMarketService({...context,capabilities:{}}),false);controller.dispose();
});

test('bootstrap restores navigation before module loads and coalesces each epoch',async()=>{
  let epoch=1,count=0; const gate=createPanelBootstrap({currentEpoch:()=>epoch});
  await gate.ensure('holdings',()=>count++);assert.equal(count,0);gate.open(1);
  await Promise.all([gate.ensure('holdings',()=>count++),gate.ensure('holdings',()=>count++)]);assert.equal(count,1);
  epoch=2;gate.close();gate.open(1);assert.equal(gate.isOpen(),false);gate.open(2);await gate.ensure('holdings',()=>count++);assert.equal(count,2);
});

test('optional restore readiness waits for the current page and rejects invalidated completion',async()=>{
  const gate=createPanelBootstrap({currentEpoch:()=>1});gate.open(1);
  const entered=deferred(),release=deferred();
  const old=gate.ensure('holdings',async()=>{entered.resolve();await release.promise;});
  await entered.promise;assert.equal(gate.has('holdings'),true);assert.equal(gate.isReady('holdings'),false);
  gate.invalidate('holdings');release.resolve();await old;
  assert.equal(gate.isReady('holdings'),false,'an obsolete completion cannot start optional watch work');
  await gate.ensure('holdings',async()=>{});assert.equal(gate.isReady('holdings'),true);
  gate.close();assert.equal(gate.isReady('holdings'),false);
});

test('critical bridge request bypasses queued optional work; aborted old intents are removed',async()=>{
  const calls=[];let time=0;const timers=[];const scheduler=createPanelHostCallScheduler({invoke:async(method)=>calls.push(method),currentScope:()=>1,now:()=>time,maxCalls:3,backgroundCalls:1,windowMs:100,
    schedule:fn=>{timers.push(fn);return fn;},cancelSchedule(){}});
  await scheduler.call('warm',{});const abort=new AbortController();const stale=scheduler.call('optional',{}, {signal:abort.signal});
  abort.abort();await assert.rejects(stale,/取消/u);await scheduler.call('base',{}, {priority:'critical'});assert.deepEqual(calls,['warm','base']);
  time=101;timers.at(-1)?.();
});

test('every awaited service stage is fenced when a project resets, including lost attach acknowledgements', async()=>{
 for(const boundary of ['services.get','services.read','services.attach','services.configure']){
  const entered=deferred(),release=deferred(),calls=[];let blocked=false,updates=0;
  const context={capabilities:{services:{version:1}},availableMethods:['get','read','attach','detach','configure','setDesired','control'].map(n=>`services.${n}`)};
  const controller=createSharedMarketController({hostCall:async(method)=>{calls.push(method);if(method===boundary&&!blocked){blocked=true;entered.resolve();await release.promise;}
   if(method==='services.get')return{desired:'always',desiredRevision:1,configRevision:0,phase:'running'};
   if(method==='services.attach')return{attachId:'old-attach'};if(method==='services.read')return{seq:1,value:{format:'quant.quotes/2',items:{}}};return{};},
   getContext:()=>context,symbols:()=>[{market:'cn',symbol:'SH600036'}],request:{cancel(){},fetch(){throw Error('spawn');}},onUpdate:()=>updates++,schedule:()=>1,unschedule(){}});
  const pending=controller.refresh();await entered.promise;const before=calls.length;const beforeUpdates=updates;controller.reset();release.resolve();await pending;
  assert.equal(calls.length,before,boundary);assert.equal(updates,beforeUpdates,boundary);
  controller.dispose();assert.equal(calls.some(method=>method==='services.detach'),false,'no old attach is applied to the new project');
 }
});

test('two live fallback windows collect once and follower reads the same committed snapshot',async()=>{
 const store=storage();let fetches=0;const entered=deferred(),release=deferred(),views=[[],[]];
 const context={availableMethods:['storage.getSnapshot','storage.compareAndSet','process.resolveEntry']};
 const controllers=[0,1].map(index=>createSharedMarketController({hostCall:store.call,getContext:()=>context,
  symbols:()=>[{market:'cn',symbol:'SH600036'}],now:()=>new Date('2026-10-28T02:00:00Z'),schedule:()=>1,unschedule(){},
  request:{cancel(){},async fetch(){fetches++;entered.resolve();await release.promise;return{contract:2,quotes:[quote]};}},
  onUpdate:(quotes,state)=>{if(!state.preserve)views[index].push(quotes);}}));
 controllers[0].setActive(true);await entered.promise;controllers[1].setActive(true);await controllers[1].refresh();assert.equal(fetches,1);
 release.resolve();await controllers[0].refresh();await controllers[1].refresh();
 assert.equal(fetches,1);assert.equal(views[1].at(-1).get('SH600036').price,quote.price);
 controllers.forEach(controller=>controller.dispose());
});

test('malformed CAS control and unsafe counters never publish or increment',async()=>{
 const valid={format:'quant.quotes/2',generation:1,commit:1,seq:0,control:{state:'active',stopRequestKey:null,migratedTo:null},holder:null,round:null,items:{}};
 for(const invalid of [{...valid,generation:'1'},{...valid,commit:-1},{...valid,seq:1.5},{...valid,control:{state:'oops'}},{...valid,holder:{instanceId:'a',leaseUntil:-1}},{...valid,unexpected:true}]){
  let writes=0;const store=createQuoteCasStore({hostCall:async method=>{if(method==='storage.compareAndSet')writes++;return{exists:true,value:invalid,revision:'r'};}});
  await assert.rejects(store.acquire(),/记录无效/u);assert.equal(writes,0);
 }
});

test('old Hosts can read verified CAS snapshots without native-entry execution capability',async()=>{
 const store=storage();const writer=createQuoteCasStore({hostCall:store.call});await writer.acquire();await writer.publish({quotes:[quote]});let value,spawn=0;
 const client=createSharedMarketController({hostCall:store.call,getContext:()=>({availableMethods:['storage.getSnapshot']}),symbols:()=>[{market:'cn',symbol:'SH600036'}],request:{cancel(){},fetch(){spawn++;}},onUpdate:(quotes,state)=>{if(!state.preserve)value=quotes;},schedule:()=>1,unschedule(){}});
 await client.refresh();assert.equal(value.get('SH600036').price,quote.price);assert.equal(spawn,0);client.dispose();
});


test('service and fallback readers reject a valid quote filed under another subscribed identity', async () => {
 const wrongItems = {'cn:SH600000': quote};
 for (const mode of ['service', 'fallback']) {
  let received;
  const context = mode === 'service'
   ? {capabilities:{services:{version:1}},availableMethods:['get','read','attach','detach','configure','setDesired','control'].map(name=>`services.${name}`)}
   : {availableMethods:['storage.getSnapshot']};
  const controller = createSharedMarketController({getContext:()=>context,symbols:()=>[{market:'cn',symbol:'SH600000'}],
   request:{cancel(){},fetch(){throw Error('no native request expected');}},schedule:()=>1,unschedule(){},
   onUpdate:(quotes,state)=>{if(!state.preserve)received=quotes;},
   hostCall:async method=>{
    if(method==='services.get')return {desired:'always',desiredRevision:1,configRevision:1,phase:'running'};
    if(method==='services.read')return {seq:1,generation:1,value:{format:'quant.quotes/2',items:wrongItems}};
    if(method==='services.attach')return {attachId:'attach'};
    if(method==='storage.getSnapshot')return {exists:true,revision:'r1',value:{format:'quant.quotes/2',generation:1,commit:1,seq:1,control:{state:'active',stopRequestKey:null,migratedTo:null},holder:null,round:null,items:wrongItems}};
    return {};
   }});
  await controller.refresh();
  assert.ok(received instanceof Map, mode);
  assert.equal(received.size, 0, `${mode} cannot treat a different symbol as the subscribed key`);
  controller.dispose();
 }
});

test('late quote packets within one CAS generation cannot regress each symbol asOf', async () => {
 const store=storage(), owner=createQuoteCasStore({hostCall:store.call,instanceId:'same-owner'});
 await owner.acquire();
 const newer=normalizeQuoteV2({market:'cn',symbol:'SH600036',price:'12',asOf:'2026-10-28T02:01:00Z',source:'fixture'}, {market:'cn',symbol:'SH600036',now:new Date('2026-10-28T02:01:00Z')});
 const olderResult=deferred();
 const latePublish=olderResult.promise.then(packet=>owner.publish(packet));
 await owner.publish({quotes:[newer]});
 const saved=store.value.value;
 olderResult.resolve({quotes:[quote]});
 await latePublish;
 assert.equal(store.value.value.generation,saved.generation);
 assert.ok(store.value.value.seq>saved.seq,'accepted round progress keeps increasing');
 assert.deepEqual(store.value.value.items['cn:SH600036'],newer,'an old quote cannot overwrite the newer accepted quote');
 // Ordering inside a single response is also irrelevant: its newest quote wins.
 await owner.publish({quotes:[newer,quote]});
 assert.deepEqual(store.value.value.items['cn:SH600036'],newer);
});


test('migrated tombstones reject stop and resume, and conflicting stop retries its original identity',async()=>{
 const store=storage(),owner=createQuoteCasStore({hostCall:store.call});await owner.acquire();
 const before=store.value;await store.call('storage.compareAndSet',{expectedRevision:before.revision,value:{...before.value,control:{state:'migrated',stopRequestKey:null,migratedTo:'quant.quotes.v3'}}});
 const migrated=store.value;await assert.rejects(owner.stop('same-stop'),/迁移/u);await assert.rejects(owner.resume(),/迁移/u);assert.deepEqual(store.value,migrated);
 const second=storage();let raced=false;const attempts=[];
 const contender=createQuoteCasStore({hostCall:async(method,params)=>{
  if(method==='storage.compareAndSet'&&params.value.control.state==='stopped'){
   attempts.push(params.value.control.stopRequestKey);
   if(!raced){raced=true;const prev=second.value;await second.call(method,{expectedRevision:prev.revision,value:{...prev.value,commit:prev.value.commit+1}});}
  }return second.call(method,params);
 }});
 await contender.acquire();await contender.stop('original-stop');assert.deepEqual(attempts,['original-stop','original-stop']);assert.equal(second.value.value.control.stopRequestKey,'original-stop');
});

test('inactive fallback releases exact ownership and polls at four times the active cadence',async()=>{
 const store=storage(),timers=new Map();let next=0,fetches=0;
 const controller=createSharedMarketController({hostCall:store.call,getContext:()=>({availableMethods:['storage.getSnapshot','storage.compareAndSet','process.resolveEntry']}),symbols:()=>[{market:'cn',symbol:'SH600036'}],
  request:{cancel(){},async fetch(){fetches++;return{contract:2,quotes:[quote]};}},onUpdate(){},schedule:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},unschedule:id=>timers.delete(id)});
 controller.setActive(true);await controller.refresh();assert.ok(store.value.value.holder);assert.equal([...timers.values()].at(-1).ms,15000);
 controller.setActive(false);await new Promise(setImmediate);assert.equal(store.value.value.holder,null);assert.equal([...timers.values()].at(-1).ms,60000);
 const other=createQuoteCasStore({hostCall:store.call,instanceId:'visible-follower'});assert.ok(await other.acquire(),'visible follower need not wait 70 seconds');
 const count=fetches;await [...timers.values()].at(-1).fn();await controller.refresh();assert.equal(fetches,count,'hidden follower cannot collect over live owner');controller.dispose();
});

test('disposing during an acquired but unacknowledged lease waits to release without launching a collector',async()=>{
 const store=storage(),entered=deferred(),ack=deferred(),released=deferred();let fetches=0;
 const controller=createSharedMarketController({hostCall:async(method,params)=>{
  const result=await store.call(method,params);
  if(method==='storage.compareAndSet'&&params.value.holder){entered.resolve();await ack.promise;}
  if(method==='storage.compareAndSet'&&!params.value.holder)released.resolve();
  return result;
 },getContext:()=>({availableMethods:['storage.getSnapshot','storage.compareAndSet','process.resolveEntry']}),symbols:()=>[{market:'cn',symbol:'SH600036'}],
 request:{cancel(){},async fetch(){fetches++;return{contract:2,quotes:[quote]};}},onUpdate(){},schedule:()=>1,unschedule(){}});
 controller.setActive(true);await entered.promise;assert.ok(store.value.value.holder);
 controller.dispose();ack.resolve();await released.promise;
 assert.equal(fetches,0);assert.equal(store.value.value.holder,null);assert.equal(store.value.value.generation,1);
});
