import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortfolioBaseReady } from '../../../apps/quant-lab/app/modules/portfolio-tool-ready.mjs';
import { registerPortfolioTools } from '../../../apps/quant-lab/app/portfolio-import.mjs';
import { createHistoryLibrarySelection } from '../../../apps/quant-lab/app/modules/history-library-selection.mjs';
import { createHistoryBatchClient } from '../../../apps/quant-lab/app/modules/history-batch-client.mjs';
import { collectionScopeArguments, createCollectorScopeBridge } from '../../../apps/quant-lab/app/modules/reviewed-entry.mjs';
import { selectionActivity, canApplySelectionSource } from '../../../apps/quant-lab/app/modules/selection-activation.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};

test('portfolio tools wait for current identity/base only, and replace readiness after project or execution switch',async()=>{
 const identityGate=deferred(),baseGate=deferred(),handlers=new Map(),reads=[];let identity={epoch:1,executionId:'a'},base=baseGate.promise;
 const ready=createPortfolioBaseReady({identityReady:identityGate.promise,getIdentity:()=>({...identity}),loadBase:async()=>base});
 registerPortfolioTools({registerTool:(name,fn)=>handlers.set(name,fn),ready,currentEpoch:()=>identity.epoch,
  hostCall:async(method)=>{reads.push(identity.epoch);assert.equal(method,'workspace.list');return{entries:[]};}});
 const first=handlers.get('get_portfolio_context')();await Promise.resolve();assert.equal(reads.length,0);identityGate.resolve();await Promise.resolve();assert.equal(reads.length,0);
 baseGate.resolve();assert.equal((await first).exists,false);assert.deepEqual(reads,[1]);
 identity={epoch:2,executionId:'b'};const next=deferred();base=next.promise;const second=handlers.get('get_portfolio_context')();await Promise.resolve();assert.deepEqual(reads,[1]);next.resolve();await second;assert.deepEqual(reads,[1,2]);
 const late=deferred(),entered=deferred();const guarded=createPortfolioBaseReady({identityReady:Promise.resolve(),getIdentity:()=>({...identity}),loadBase:async()=>{entered.resolve();await late.promise;}});
 const pending=guarded();await entered.promise;identity={epoch:2,executionId:'c'};late.resolve();await assert.rejects(pending,/执行身份已切换/u);
});

test('source apply obeys bootstrap/visibility and restored background watch remains active off the watch tab',()=>{
 for(const ready of [false,true])for(const visible of [false,true])for(const module of ['research','holdings','today','watch']){
  const state={ready,visible,module,backgroundRestored:true};const expected=ready&&visible&&['today','watch'].includes(module);
  assert.equal(canApplySelectionSource(state),expected);assert.equal(selectionActivity(state).backgroundWatch,ready&&visible);
 }
 assert.deepEqual(selectionActivity({ready:true,visible:true,module:'research',backgroundRestored:false}),{active:false,backgroundWatch:false});
});

function store(){const records=new Map(),calls=[];let lose=false;return{records,calls,lose(){lose=true;},async call(method,params){calls.push({method,params});const old=records.get(params.key)??{exists:false,revision:null,value:null};
 if(method==='storage.getSnapshot')return structuredClone(old);
 if(method==='storage.compareAndSet'){if(old.revision!==params.expectedRevision)return{updated:false,snapshot:structuredClone(old)};const value={exists:true,value:params.value,revision:`r${calls.length}`};records.set(params.key,value);if(lose){lose=false;throw Error('lost receipt');}return{updated:true,snapshot:structuredClone(value)};}
 throw Error(method);}};}

test('isolated history selection is CAS durable, lost receipt safe, and used by bounded tasks in a separate intent record',async()=>{
 const storage=store();let epoch=1;const library=createHistoryLibrarySelection({hostCall:storage.call,currentEpoch:()=>epoch});
 assert.equal(await library.restore(),null);storage.lose();const libraryId=await library.select();assert.match(libraryId,/^[a-f0-9]{32}$/u);
 assert.equal(await createHistoryLibrarySelection({hostCall:storage.call,currentEpoch:()=>epoch}).restore(),libraryId);
 const starts=[];const task=createHistoryBatchClient({hostCall:async(method,params)=>{
  if(method.startsWith('storage.'))return storage.call(method,params);
  if(method==='tasks.find')return null;
  if(method==='tasks.start'){starts.push(params);return{id:'isolated',status:'succeeded'};}throw Error(method);
 },currentEpoch:()=>epoch,contextState:()=>({availableMethods:['storage.getSnapshot','storage.compareAndSet','tasks.find','tasks.start','tasks.get','tasks.cancel']})});
 await task.run({scope:'core',source:'tencent-ifzq',maxItems:20,libraryId});
 assert.equal(starts[0].input.request.libraryId,libraryId);assert.deepEqual(starts[0].input.directoryArguments,[{argumentName:'--data-dir',directory:'app-data'}]);
 assert.ok(storage.records.has(`quant.history.batch.v1.${libraryId}`));assert.equal(storage.records.has('quant.history.batch.v1'),false);
 assert.equal(JSON.stringify(starts).includes('/Users/'),false,'no native path is supplied by the browser');
});

test('library selection rejects stale project acknowledgements and corrupted/future records',async()=>{
 const storage=store(),entered=deferred(),release=deferred();let epoch=1;
 const library=createHistoryLibrarySelection({currentEpoch:()=>epoch,hostCall:async(method,params)=>{entered.resolve();await release.promise;return storage.call(method,params);}});
 const pending=library.select();await entered.promise;epoch=2;library.reset();release.resolve();await assert.rejects(pending,/项目已切换/u);assert.equal(storage.calls.some(call=>call.method==='storage.compareAndSet'),false);
 storage.records.set('quant.history.library.v2',{exists:true,revision:'r',value:{format:'quant.history.library/2',libraryId:'a'.repeat(32)}});
 await assert.rejects(createHistoryLibrarySelection({hostCall:storage.call,currentEpoch:()=>2}).select(),/格式不受支持/u);
});

test('production collector adapter binds selected entry to project scope, not session/execution, and routes isolated history id',async()=>{
 const a={cwd:'/project/a',sessionId:'one',executionId:'one',appId:'quant-lab'},same={...a,sessionId:'two',executionId:'two'};
 assert.deepEqual(await collectionScopeArguments(a),await collectionScopeArguments(same));assert.notDeepEqual(await collectionScopeArguments(a),await collectionScopeArguments({...a,cwd:'/project/b'}));
 let epoch=1;const calls=[];const bridge=createCollectorScopeBridge({currentEpoch:()=>epoch,getContext:()=>a,getLibraryId:()=> 'a'.repeat(32),invoke:async(method,params)=>{calls.push({method,params});return method==='process.resolveEntry'?{handle:'reviewed'}:{processId:'p'};}});
 await bridge('process.resolveEntry',{name:'fetch-holding-quotes',executableHandle:'node'});await bridge('process.spawn',{entryHandle:'reviewed',args:['[]']});
 const argv=calls.at(-1).params.args;assert.equal(argv[0],'[]');assert.deepEqual(argv.slice(1,3),await collectionScopeArguments(a));assert.deepEqual(argv.slice(-2),['--library-id','a'.repeat(32)]);
 await bridge('process.resolveEntry',{name:'initialize-a-share-history',executableHandle:'node'});await bridge('process.spawn',{entryHandle:'status-reviewed',args:['--status','--library-id','b'.repeat(32)]});
 assert.equal(calls.at(-1).params.args.includes('--collector-scope'),false,'initializer receives no collector-only option');
});

test('pending library restore cannot launch a collector after an execution epoch switch',async()=>{
 const entered=deferred(),release=deferred(),calls=[];let epoch=1;
 const library=createHistoryLibrarySelection({currentEpoch:()=>epoch,hostCall:async()=>{
  entered.resolve();await release.promise;return{exists:true,revision:'old',value:{format:'quant.history.library/1',libraryId:'a'.repeat(32)}};
 }});
 const bridge=createCollectorScopeBridge({currentEpoch:()=>epoch,getContext:()=>({cwd:`/project/${epoch}`}),ensureLibraryId:()=>library.restore(),invoke:async(method,params)=>{
  calls.push({method,params});return{handle:'reviewed'};
 }});
 await bridge('process.resolveEntry',{name:'build-a-share-selection',executableHandle:'node'});
 const pending=bridge('process.spawn',{entryHandle:'reviewed',args:[]});await entered.promise;
 epoch=2;library.reset();release.resolve();await assert.rejects(pending,/项目已切换/u);
 assert.equal(calls.some(call=>call.method==='process.spawn'),false);assert.equal(library.id,null);
});
