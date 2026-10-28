import assert from "node:assert/strict";
import test from "node:test";
import { createHistoryDataController, historyAutofillNeeded, historyCoveragePresentation, parseHistoryLibrarySummary } from "../../../apps/quant-lab/app/modules/history-data-ui.mjs";
import { createCollectorScopeBridge } from "../../../apps/quant-lab/app/modules/reviewed-entry.mjs";

function contractedUniverse() {
  return {
    scope: "full", source: "tencent-ifzq", adjust: "qfq", limit: 5_056, years: 3,
    marketDate: "2026-09-11", updatedAt: "2026-09-12T14:36:00Z", total: 5_056, ready: 5_056,
    cached: 5_108, failed: 0, loaded: 0, skipped: 5_056, rebuilt: 0, bars: 3_600_000, storageBytes: 200_000_000,
    remaining: 0, attempted: 5_056, paused: false, sessionPhase: "close", provisional: false,
    from: "2023-09-11", to: "2026-09-07", confirmedThrough: "2026-09-07", networkCheckedThrough: "2026-09-04",
    snapshotBackfillThrough: "2026-09-11", snapshotBackfillDeferred: 5_108, snapshotGapSeries: 5_083,
    snapshotGapDates: ["2026-09-08", "2026-09-09"], latestDateDistribution: [{ date: "2026-09-07", count: 5_081 }],
    auditTrail: [{ at: "2026-09-10T10:00:00Z", kind: "snapshot-check", status: "partial", from: "2026-09-04", through: "2026-09-11", updatedSeries: 5_086, addedBars: 0, skippedSeries: 5_086, failedSeries: 0 }],
  };
}

test("a shrinking listed universe does not invalidate a larger historical audit event", () => {
  const parsed = parseHistoryLibrarySummary(contractedUniverse());
  assert.equal(parsed.total, 5_056);
  assert.equal(parsed.cached, 5_108);
  assert.equal(parsed.auditTrail[0].updatedSeries, 5_086);
  assert.equal(parsed.auditTrail[0].skippedSeries, 5_086);
  const invalid = contractedUniverse();
  invalid.auditTrail[0].updatedSeries = 10_001;
  assert.throws(() => parseHistoryLibrarySummary(invalid), /updatedSeries/u);
});

test("checking local snapshots cannot mark missing actual daily bars current or suppress network fill", () => {
  const parsed = parseHistoryLibrarySummary(contractedUniverse());
  const view = historyCoveragePresentation(parsed);
  assert.equal(view.through, "2026-09-07");
  assert.equal(view.current, false);
  assert.equal(view.state, "stale");
  assert.match(view.note, /快照检查不代表日线已补齐/u);
  assert.equal(historyAutofillNeeded(parsed, "2026-09-11", new Date("2026-09-12T16:00:00Z")), true);
  assert.equal(historyAutofillNeeded({ ...parsed, snapshotBackfillDeferred: 0, snapshotGapSeries: 0, snapshotGapDates: [] }, "2026-09-11", new Date("2026-09-12T16:00:00Z")), true, "a local check marker alone cannot suppress a missing-date network pass");
  const checked = { ...parsed, networkCheckedThrough: "2026-09-11" };
  assert.equal(historyCoveragePresentation(checked).current, false);
  assert.equal(historyAutofillNeeded(checked, "2026-09-11", new Date("2026-09-12T16:00:00Z")), false, "a completed network pass does not endlessly recheck legitimately unavailable bars");
});

test("mixed history dates and failed checks trigger one full network verification", () => {
  const summary = parseHistoryLibrarySummary({
    ...contractedUniverse(),
    to: "2026-09-11", confirmedThrough: "2026-09-11",
    snapshotBackfillDeferred: 0, snapshotGapSeries: 0, snapshotGapDates: [],
    latestDateDistribution: [{ date: "2026-09-11", count: 1 }, { date: "2026-09-07", count: 5_080 }],
  });
  const now = new Date("2026-09-12T16:00:00Z");
  assert.equal(historyCoveragePresentation(summary).state, "stale");
  assert.equal(historyAutofillNeeded(summary, "2026-09-11", now), true,
    "one current series cannot hide thousands of lagging cached histories");
  const checked = parseHistoryLibrarySummary({ ...summary, networkCheckedThrough: "2026-09-11" });
  assert.equal(historyAutofillNeeded(checked, "2026-09-11", now), false,
    "a completed availability check stops repeat passes even when some series stay behind");

  const failed = parseHistoryLibrarySummary({
    ...summary, failed: 1, latestDateDistribution: [{ date: "2026-09-11", count: 5_081 }],
  });
  assert.equal(historyAutofillNeeded(failed, "2026-09-11", now), true,
    "an exhausted scope with a failed request still needs a completed network pass");
  assert.equal(historyAutofillNeeded({ ...failed, networkCheckedThrough: "2026-09-11" }, "2026-09-11", now), false);
});

class Element {
  constructor() { this.children = []; this.dataset = {}; this.style = { setProperty() {} }; this.value = ""; this.textContent = ""; this.listeners = new Map(); this.classList = { toggle() {}, add() {}, remove() {} }; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  get firstElementChild() { return this.children[0]; }
  get options() { return this.children; }
  querySelector() { return this.child ??= new Element(); }
  querySelectorAll() { return []; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name) { this.listeners.delete(name); }
  setAttribute() {}
}

test("unreadable local status is diagnosed explicitly and recovery preserves existing files", async () => {
  const original = { window: globalThis.window, document: globalThis.document };
  const timers = new Map(); let id = 0;
  globalThis.window = { setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(key) { timers.delete(key); } };
  globalThis.document = { createElement: () => new Element(), createTextNode: (text) => ({ textContent: text }) };
  const elements = new Proxy({}, { get(target, key) { return target[key] ??= new Element(); } });
  elements.market.value = "cn"; elements.bootstrapSource.value = "tencent-ifzq";
  const events = new Map();
  let invalid = true;
  let controller;
  try {
    controller = createHistoryDataController({ elements, currentEpoch: () => 0, contextState: () => ({ trusted: true }), notify() {}, now: () => new Date("2026-09-12T16:00:00Z"),
      onHostEvent(name, listener) { events.set(name, listener); return () => events.delete(name); },
      async hostCall(method) {
        if (method === "process.resolveEntry") return { handle: "reviewed-entry" };
        if (method === "process.find") return { available: true, handle: "node" };
        if (method === "filesystem.getKnownDirectory") return { handle: "app-data" };
        if (method === "process.spawn") {
          const processId = `p${++id}`;
          setImmediate(() => { events.get("process.output")?.({ processId, stream: "stdout", text: invalid ? "malformed-json" : JSON.stringify(contractedUniverse()) }); events.get("process.exit")?.({ processId, code: 0 }); });
          return { processId };
        }
        return {};
      },
    });
    assert.equal(await controller.refreshHistorySummaryFromLocal(), null);
    assert.equal(elements.bootstrapBadge.textContent, "状态恢复失败");
    assert.equal(elements.bootstrapCoverage.textContent, "已有文件状态暂不可读");
    assert.match(elements.bootstrapStatus.textContent, /不代表历史库未初始化/u);
    assert.equal(elements.bootstrapAction.textContent, "重新读取状态");
    invalid = false;
    assert.equal((await controller.refreshHistorySummaryFromLocal()).cached, 5_108);
    assert.notEqual(elements.bootstrapBadge.textContent, "尚未初始化");
  } finally {
    controller?.dispose?.();
    globalThis.window = original.window;
    globalThis.document = original.document;
  }
});


test("history reset drops runtime/status from the old project and fences pending discovery", async () => {
  const original = { window: globalThis.window, document: globalThis.document };
  const timers = new Map(); let id = 0, epoch = 1, enteredResolve, releaseResolve, blocking = false;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  const release = new Promise(resolve => { releaseResolve = resolve; });
  globalThis.window = { setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(key) { timers.delete(key); } };
  globalThis.document = { createElement: () => new Element(), createTextNode: text => ({ textContent: text }) };
  const elements = new Proxy({}, { get(target, key) { return target[key] ??= new Element(); } });
  elements.market.value = "cn"; elements.bootstrapSource.value = "tencent-ifzq";
  const events = new Map(), calls = []; let controller;
  try {
    controller = createHistoryDataController({ elements, currentEpoch: () => epoch, contextState: () => ({ trusted: true }), notify() {}, now: () => new Date("2026-09-12T16:00:00Z"),
      onHostEvent(name, listener) { events.set(name, listener); return () => events.delete(name); },
      async hostCall(method) {
        calls.push({ method, epoch });
        if (method === "process.find") { if (blocking) { enteredResolve(); await release; } return { available: true, handle: `node-${epoch}` }; }
        if (method === "process.resolveEntry") return { handle: "reviewed-entry" };
        if (method === "filesystem.getKnownDirectory") return { handle: "app-data" };
        if (method === "process.spawn") {
          const processId = `p${++id}`;
          setImmediate(() => { events.get("process.output")?.({ processId, stream: "stdout", text: JSON.stringify(contractedUniverse()) }); events.get("process.exit")?.({ processId, code: 0 }); });
          return { processId };
        }
        return {};
      },
    });
    await controller.refreshHistorySummaryFromLocal();
    assert.equal(elements.bootstrapCoverage.textContent.includes("状态暂不可读"), false);
    epoch = 2; controller.reset();
    assert.equal(elements.bootstrapBadge.textContent, "检查本地基础库");
    blocking = true;
    const pending = controller.refreshHistorySummaryFromLocal(); await entered;
    const count = calls.length; epoch = 3; controller.reset(); releaseResolve();
    assert.equal(await pending, null);
    assert.equal(calls.length, count, "old discovery cannot request a directory or spawn after switching");
    assert.equal(calls.filter(call => call.method === "process.find").length, 2, "new project resolves its own runtime");
  } finally {
    controller?.dispose?.(); globalThis.window = original.window; globalThis.document = original.document;
  }
});


test("legacy history rejection offers an isolated library and routes both task and status to it", async () => {
 const original={window:globalThis.window,document:globalThis.document};let id=0;const timers=new Map();
 globalThis.window={setTimeout(fn){timers.set(++id,fn);return id;},clearTimeout(key){timers.delete(key);}};
 globalThis.document={createElement:()=>new Element(),createTextNode:text=>({textContent:text})};
 const elements=new Proxy({}, {get(target,key){return target[key]??=new Element();}});elements.market.value='cn';elements.bootstrapSource.value='tencent-ifzq';elements.bootstrapScope.value='core';
 const events=new Map(),records=new Map(),calls=[];let controller;
 const methods=['storage.getSnapshot','storage.compareAndSet','tasks.find','tasks.start','tasks.get','tasks.cancel'];
 try {
  controller=createHistoryDataController({elements,currentEpoch:()=>1,contextState:()=>({trusted:true,availableMethods:methods}),notify(){},now:()=>new Date('2026-09-12T16:00:00Z'),onHostEvent(name,fn){events.set(name,fn);return()=>events.delete(name);},
   async hostCall(method,params){calls.push({method,params});
    if(method==='storage.getSnapshot')return structuredClone(records.get(params.key)??{exists:false,value:null,revision:null});
    if(method==='storage.compareAndSet'){const old=records.get(params.key)??{revision:null};if(old.revision!==params.expectedRevision)return{updated:false,snapshot:old};const next={exists:true,value:params.value,revision:`r${++id}`};records.set(params.key,next);return{updated:true,snapshot:structuredClone(next)};}
    if(method==='storage.set'){records.set(params.key,{exists:true,value:params.value,revision:`r${++id}`});return{};}
    if(method==='process.find')return{available:true,handle:'node'};
    if(method==='filesystem.getKnownDirectory')return{handle:'app-data'};
    if(method==='process.resolveEntry')return{handle:'entry'};
    if(method==='process.spawn'){const processId=`p${++id}`;setImmediate(()=>{events.get('process.output')({processId,stream:'stdout',text:JSON.stringify(contractedUniverse())});events.get('process.exit')({processId,code:0});});return{processId};}
    if(method==='tasks.find')return null;
    if(method==='tasks.start')return params.input.request.libraryId?{id:'isolated',status:'succeeded',result:contractedUniverse()}:{id:'legacy',status:'failed',error:{code:'HISTORY_LEGACY_PROTOCOL',message:'旧历史协议不可混写'}};
    return{};
   }});
  await controller.refreshHistorySummaryFromLocal();await elements.bootstrapAction.listeners.get('click')();
  assert.match(elements.bootstrapStatus.textContent,/使用本项目隔离历史库/u);
  await elements.librarySelect.listeners.get('click')();const libraryId=controller.libraryId;assert.match(libraryId,/^[a-f0-9]{32}$/u);
  const tasks=calls.filter(call=>call.method==='tasks.start');assert.equal(tasks.length,2);assert.equal(tasks[1].params.input.request.libraryId,libraryId);
  assert.ok(calls.some(call=>call.method==='process.spawn'&&call.params.args.includes('--library-id')&&call.params.args.includes(libraryId)));
  assert.match(elements.libraryLocation.textContent,/本项目隔离/u);assert.doesNotMatch(elements.bootstrapStatus.textContent,/HISTORY_LEGACY_PROTOCOL/u);
 } finally {controller?.dispose();globalThis.window=original.window;globalThis.document=original.document;}
});

test("cold Watch, Stock, Holdings and probe collectors restore only the selected library record before spawning", async () => {
 const original={window:globalThis.window,document:globalThis.document};
 globalThis.window={setTimeout(){return 1;},clearTimeout(){}};
 globalThis.document={createElement:()=>new Element(),createTextNode:text=>({textContent:text})};
 const libraryId='c'.repeat(32),calls=[],elements=new Proxy({}, {get(target,key){return target[key]??=new Element();}});
 elements.market.value='cn';const context={trusted:true,cwd:'/fixture/project',availableMethods:['storage.getSnapshot']};let controller;
 try {
  const invoke=async(method,params)=>{calls.push({method,params});
   if(method==='storage.getSnapshot')return{exists:true,revision:'chosen',value:{format:'quant.history.library/1',libraryId}};
   if(method==='process.resolveEntry')return{handle:`entry:${params.name}`};
   if(method==='process.spawn')return{processId:'p'};throw Error(`unexpected ${method}`);
  };
  controller=createHistoryDataController({elements,hostCall:invoke,currentEpoch:()=>1,contextState:()=>context,notify(){},now:()=>new Date('2026-10-28T02:00:00Z')});
  assert.equal(controller.libraryId,null);
  const bridge=createCollectorScopeBridge({invoke,getContext:()=>context,currentEpoch:()=>1,ensureLibraryId:()=>controller.ensureLibraryId()});
  for(const name of ['build-a-share-selection','fetch-a-share-stock','fetch-us-stock','fetch-holding-quotes','build-market-pulse']){
   const entry=await bridge('process.resolveEntry',{name,executableHandle:'node'});
   await bridge('process.spawn',{entryHandle:entry.handle,args:['fixture']});
   assert.deepEqual(calls.at(-1).params.args.slice(-2),['--library-id',libraryId]);
  }
  assert.equal(calls.filter(call=>call.method==='storage.getSnapshot').length,1,'cached single-record restore never scans history');
  assert.equal(calls.some(call=>/workspace|tasks|process.find/u.test(call.method)),false);
 }finally{controller?.dispose();globalThis.window=original.window;globalThis.document=original.document;}
});
