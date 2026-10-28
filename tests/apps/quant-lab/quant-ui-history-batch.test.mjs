import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryBatchClient } from '../../../apps/quant-lab/app/modules/history-batch-client.mjs';
const methods=['tasks.start','tasks.find','tasks.get','tasks.cancel','storage.getSnapshot','storage.compareAndSet'];
function fixture(){
 let snapshot={exists:false,value:null,revision:null};const jobs=new Map(),calls=[];let lose=true;
 const hostCall=async(method,params)=>{calls.push({method,params});
  if(method==='storage.getSnapshot')return structuredClone(snapshot);
  if(method==='storage.compareAndSet'){
   if(params.expectedRevision!==snapshot.revision)return{updated:false,snapshot:structuredClone(snapshot)};
   snapshot={exists:true,value:params.value,revision:`r${params.value.sequence}`};return{updated:true,snapshot:structuredClone(snapshot)};
  }
  if(method==='tasks.find')return jobs.get(params.requestKey)??null;
  if(method==='tasks.get')return [...jobs.values()].find(job=>job.id===params.id);
  if(method==='tasks.start'){
   assert.equal(params.entry,'quant-history-batch');assert.equal(params.input.request.maxItems,20);
   assert.deepEqual(params.input.directoryArguments,[{argumentName:'--data-dir',directory:'app-data'}]);
   const job=jobs.get(params.requestKey)??{id:`job-${jobs.size}`,status:'succeeded',result:{batch:{pending:10}}};jobs.set(params.requestKey,job);
   if(lose){lose=false;throw Error('lost response');}return job;
  }
  throw Error(method);
 };
 return{hostCall,calls,jobs,get snapshot(){return snapshot;},seed(value){snapshot=value;}};
}
const options=store=>({hostCall:store.hostCall,contextState:()=>({availableMethods:methods}),currentEpoch:()=>1});
test('history durable intent survives a lost start receipt and reopening only queries existing task',async()=>{
 const store=fixture(),client=createHistoryBatchClient(options(store));
 const request={scope:'core',source:'tencent-ifzq',maxItems:20};
 const result=await client.run(request);assert.equal(result.status,'succeeded');
 assert.equal(store.calls.filter(call=>call.method==='tasks.start').length,1);
 assert.equal((await createHistoryBatchClient(options(store)).restore()).id,result.id);
 assert.equal(store.calls.filter(call=>call.method==='tasks.start').length,1);
 assert.equal(store.calls.at(-1).method,'tasks.find');
});
test('explicit resume after intent-only crash reuses identical requestKey and rejects changed inputs',async()=>{
 const store=fixture();store.seed({exists:true,value:{format:'quant.history.batch/1',sequence:4,requestKey:'original',request:{scope:'core',source:'tencent-ifzq',maxItems:20}},revision:'r4'});
 const client=createHistoryBatchClient(options(store));
 await assert.rejects(client.run({scope:'full',source:'tencent-ifzq',maxItems:20}),/相同来源与范围/u);
 const result=await client.run({scope:'core',source:'tencent-ifzq',maxItems:20});assert.equal(result.status,'succeeded');
 assert.equal(store.calls.find(call=>call.method==='tasks.start').params.requestKey,'original');
 assert.equal(store.calls.filter(call=>call.method==='storage.compareAndSet').length,0);
});
test('old Hosts cannot start an unreviewed or unbounded history writer',async()=>{
 const client=createHistoryBatchClient({hostCall(){throw Error('must not invoke');},contextState:()=>({availableMethods:['process.spawn']}),currentEpoch:()=>1});
 assert.equal(client.supports(),false);await assert.rejects(client.run({maxItems:20}),/更新 CodeShell/u);
});

test('history batch fences getSnapshot/find/CAS/start acknowledgements across project switches',async()=>{
 for(const boundary of ['storage.getSnapshot','tasks.find','storage.compareAndSet','tasks.start']){
  const store=fixture();let epoch=1,enteredResolve,releaseResolve,blocked=false;const entered=new Promise(r=>enteredResolve=r),release=new Promise(r=>releaseResolve=r);
  if(boundary==='tasks.find')store.seed({exists:true,value:{format:'quant.history.batch/1',sequence:1,requestKey:'prior',request:{scope:'core',source:'tencent-ifzq',maxItems:20}},revision:'r1'});
  const calls=[];const client=createHistoryBatchClient({hostCall:async(method,params)=>{calls.push({method,epoch});if(method===boundary&&!blocked){blocked=true;enteredResolve();await release;}return store.hostCall(method,params);},contextState:()=>({availableMethods:methods}),currentEpoch:()=>epoch});
  const pending=client.run({scope:'core',source:'tencent-ifzq',maxItems:20});await entered;const count=calls.length;epoch=2;releaseResolve();
  await assert.rejects(pending,/项目已切换/u);assert.equal(calls.length,count,boundary);assert.equal(calls.some(call=>call.epoch===2),false,boundary);
  await client.cancel();assert.equal(calls.length,count,'stale task ID is never adopted');
 }
});


test('malformed or future history intents cannot be reused or overwritten', async () => {
 const request={scope:'core',source:'tencent-ifzq',maxItems:20};
 for (const change of [{sequence:'1'}, {sequence:Number.MAX_SAFE_INTEGER+1}, {format:'quant.history.batch/2'}, {requestKey:''}, {request:{...request,maxItems:1000}}]) {
  const store=fixture();store.seed({exists:true,value:{format:'quant.history.batch/1',sequence:1,requestKey:'prior',request,...change},revision:'r1'});
  const client=createHistoryBatchClient(options(store));
  await assert.rejects(client.run(request),/格式不受支持或已损坏/u);
  await assert.rejects(client.restore(),/格式不受支持或已损坏/u);
  assert.equal(store.calls.some(call=>call.method!=='storage.getSnapshot'),false);
 }
});
