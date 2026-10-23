import assert from "node:assert/strict";
import { test } from "node:test";
import { createRendererController } from "../../../apps/design-studio/app/renderer-controller.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const turn = () => new Promise((resolve) => setImmediate(resolve));
const view = { width: 400, height: 300, dpr: 2, pan: { x: 20, y: 30 }, zoom: 0.8 };
const design = (name) => ({ name, nodes: [{ id: name, text: `Original ${name}` }] });

function harness(overrides = {}) {
  const calls = [], states = [], instances = [], canvas = new EventTarget();
  let resources = 0, loads = 0;
  const getResources = () => { resources += 1; return new Map([["image", { bytes: new Uint8Array([1]) }]]); };
  const factory = async (options) => {
    const id = instances.length;
    calls.push(["create", id]);
    const instance = {
      async setScene(snapshot, { resources }) {
        calls.push(["setScene", id, snapshot, resources]);
        return overrides.setScene?.(snapshot, id);
      },
      async resize(...size) { calls.push(["resize", id, ...size]); return overrides.resize?.(size, id); },
      async render(camera) { calls.push(["render", id, camera]); return overrides.render?.(camera, id); },
      async dispose() { calls.push(["dispose", id]); return overrides.dispose?.(id); },
      stats() { return { renderer: id }; },
    };
    instances.push(instance);
    await overrides.create?.(instance, options, id);
    return instance;
  };
  const controller = createRendererController({
    canvas, assetsBaseUrl: "/runtimes/", capability: { packageAssets: { wasm: true } },
    loadRenderer: async () => { loads += 1; await overrides.load?.(); return { createRenderer: factory }; },
    onState: (state) => { states.push(state); overrides.onState?.(state); },
    ...overrides.options,
  });
  const update = (name, extra = {}) => controller.update({
    key: `workspace/page/${name}`, revision: 1, design: design(name), getResources,
    viewport: view, ...extra,
  });
  const count = (method) => calls.filter(([name]) => name === method).length;
  return { controller, update, getResources, canvas, calls, states, instances, count,
    get resources() { return resources; }, get loads() { return loads; } };
}

test("GPU is the default and becomes active only after the current first draw", async () => {
  const scene = deferred(), draw = deferred();
  const h = harness({ setScene: () => scene.promise, render: () => draw.promise });
  assert.equal(h.controller.state().mode, "gpu");
  assert.equal(h.controller.state().status, "loading");
  assert.equal(h.resources, 0);
  assert.equal(h.loads, 0);
  const enabled = h.update("A");
  await turn();
  assert.equal(h.count("setScene"), 1);
  assert.equal(h.controller.state().active, false);
  assert.equal(h.count("resize"), 0);
  scene.resolve();
  await turn();
  assert.equal(h.count("resize"), 1);
  assert.equal(h.count("render"), 1);
  assert.equal(h.controller.state().active, false);
  draw.resolve();
  await enabled;
  assert.equal(h.controller.state().active, true);
  assert.equal(h.controller.state().status, "active");
  assert.equal(h.controller.state().fallback, false);
  assert.equal(h.controller.state().loading, false);
  await h.controller.dispose();
});

test("content snapshots and resource loading occur once per key/revision, never for selection or pan", async () => {
  const h = harness();
  let reads = 0, value = "A";
  const source = { get name() { reads += 1; return value; }, nodes: [{ id: "original", text: "Original" }] };
  await h.update("A", { design: source });
  source.nodes[0].text = "Temporary edit";
  value = "Changed";
  await h.controller.setMode("gpu");
  const snapshot = h.calls.find(([method]) => method === "setScene")[2];
  assert.equal(snapshot.name, "A");
  assert.equal(snapshot.nodes[0].text, "Original");
  for (let index = 0; index < 12; index += 1) {
    await h.update("A", { design: source, viewport: { ...view, pan: { x: index, y: -index } } });
  }
  assert.equal(reads, 1);
  assert.equal(h.count("create"), 1);
  assert.equal(h.count("setScene"), 1);
  assert.equal(h.resources, 1);
  assert.equal(h.count("resize"), 1);
  await h.update("A", { revision: 2, design: source });
  assert.equal(reads, 2);
  assert.equal(h.count("setScene"), 2);
  assert.equal(h.resources, 2);
  assert.equal(h.count("create"), 1);
  assert.equal(h.count("dispose"), 0);
  assert.equal(source.nodes[0].text, "Temporary edit");
  await h.controller.dispose();
});

test("a workspace/page change during resource loading cannot create or show the old scene", async () => {
  const resource = deferred(), h = harness();
  const old = h.update("A", { getResources: () => resource.promise });
  await turn();
  const latest = h.update("B");
  assert.equal(h.controller.state().active, false);
  resource.resolve(new Map());
  await Promise.all([old, latest]);
  assert.equal(h.count("create"), 1);
  assert.deepEqual(h.calls.filter(([method]) => method === "setScene").map((call) => call[2].name), ["B"]);
  assert.ok(h.states.filter((state) => state.active).every((state) => state.key === "workspace/page/B"));
  await h.controller.dispose();
});

test("a stale asynchronous factory is disposed before the next factory uses the same canvas", async () => {
  const create = deferred(), h = harness({ create: (_instance, _options, id) => id === 0 ? create.promise : undefined });
  const old = h.update("A");
  await turn();
  const latest = h.update("B");
  assert.equal(h.count("create"), 1);
  create.resolve();
  await Promise.all([old, latest]);
  assert.deepEqual(h.calls.filter(([method]) => ["create", "dispose"].includes(method)),
    [["create", 0], ["dispose", 0], ["create", 1]]);
  assert.deepEqual(h.calls.filter(([method]) => method === "setScene").map((call) => call[2].name), ["B"]);
  await h.controller.dispose();
  assert.equal(h.count("dispose"), 2);
});

test("a stale setScene completes hidden and is retired before the current scene can activate", async () => {
  const scene = deferred(), h = harness({ setScene: (_design, id) => id === 0 ? scene.promise : undefined });
  const old = h.update("A");
  await turn();
  const latest = h.update("B");
  assert.equal(h.controller.state().active, false);
  scene.resolve();
  await Promise.all([old, latest]);
  assert.deepEqual(h.calls.filter(([method]) => method === "render").map((call) => call[1]), [1]);
  assert.ok(h.states.filter((state) => state.active).every((state) => state.key === "workspace/page/B"));
  assert.equal(h.count("dispose"), 1);
  await h.controller.dispose();
});

test("viewport changes during asynchronous resize are drawn at the latest size before activation", async () => {
  const resize = deferred();
  let first = true;
  const h = harness({ resize: () => { if (first) { first = false; return resize.promise; } } });
  const enabled = h.update("A");
  await turn();
  const moved = h.controller.render({ width: 600, height: 350, pan: { x: 77, y: 88 } });
  resize.resolve();
  await Promise.all([enabled, moved]);
  assert.deepEqual(h.calls.filter(([method]) => method === "resize").at(-1).slice(2), [600, 350, 2]);
  assert.deepEqual(h.calls.filter(([method]) => method === "render").at(-1)[2], { pan: { x: 77, y: 88 }, zoom: 0.8 });
  assert.equal(h.states.filter((state) => state.active).length, 1);
  await h.controller.dispose();
});

test("unavailable Wasm capability reports unavailable without loading assets or choosing another renderer", async () => {
  const h = harness({ options: { capability: () => ({ capabilities: { packageAssets: { wasm: false } } }) } });
  await h.update("A");
  await h.controller.setMode("gpu");
  assert.equal(h.controller.state().active, false);
  assert.equal(h.controller.state().status, "unavailable");
  assert.equal(h.controller.state().fallback, false);
  assert.equal(h.controller.state().reason, "wasm-unavailable");
  assert.equal(h.loads, 0);
  assert.equal(h.resources, 0);
  await h.controller.dispose();
});

for (const stage of ["load", "create", "setScene", "resize", "render"]) {
  test(`${stage} failure is isolated, retires the surface and does not retry on pan`, async () => {
    const h = harness({ [stage]: () => { throw new Error(`${stage} failed`); } });
    await assert.doesNotReject(h.update("A"));
    assert.equal(h.controller.state().active, false);
    assert.equal(h.controller.state().status, "error");
    assert.equal(h.controller.state().fallback, false);
    assert.match(h.controller.state().reason, new RegExp(`${stage}:`));
    const creates = h.count("create"), loads = h.loads;
    await h.controller.render({ pan: { x: 90, y: 100 } });
    assert.equal(h.count("create"), creates);
    assert.equal(h.loads, loads);
    // A rejected factory never transfers its internally allocated instance to
    // the controller; cleanup inside a failed factory belongs to that SDK.
    assert.equal(h.count("dispose"), h.instances.length - Number(stage === "create"));
    await h.controller.dispose();
  });
}

test("resource failure can be retried explicitly, while repeated GPU selection reuses document resources", async () => {
  const h = harness();
  let attempts = 0;
  await h.update("A", { getResources: () => {
    attempts += 1;
    if (attempts === 1) throw new Error("Resource unavailable");
    return new Map();
  } });
  assert.match(h.controller.state().reason, /^resources:/u);
  assert.equal(h.loads, 0);
  await h.controller.setMode("gpu");
  assert.equal(h.controller.state().active, true);
  await h.controller.setMode("gpu");
  assert.equal(h.controller.state().active, true);
  assert.equal(attempts, 2);
  assert.equal(h.count("create"), 1);
  assert.equal(h.count("setScene"), 1);
  await h.controller.dispose();
});

test("temporary suspension reports loading and all positive zoom levels reuse the current scene", async () => {
  const h = harness();
  await h.update("A"); await h.controller.setMode("gpu");
  const firstRenders = h.count("render");
  await h.controller.suspend();
  assert.equal(h.controller.state().active, false);
  assert.equal(h.controller.state().reason, "suspended");
  assert.equal(h.controller.state().status, "loading");
  assert.equal(h.controller.state().fallback, false);
  await h.controller.resume();
  assert.equal(h.count("render"), firstRenders);
  assert.equal(h.count("setScene"), 1);
  await h.controller.render({ zoom: 1.1 });
  assert.equal(h.controller.state().active, true);
  assert.equal(h.controller.state().status, "active");
  await h.controller.render({ zoom: 16 });
  assert.equal(h.controller.state().active, true);
  assert.equal(h.controller.state().reason, null);
  await h.controller.render({ zoom: 0.8 });
  assert.equal(h.controller.state().active, true);
  assert.equal(h.count("setScene"), 1);
  await h.controller.suspend();
  await h.update("A", { revision: 2, suspended: true });
  assert.equal(h.count("setScene"), 1);
  assert.equal(h.count("dispose"), 0);
  await h.controller.resume();
  assert.equal(h.count("setScene"), 2);
  assert.equal(h.count("create"), 1);
  assert.equal(h.resources, 2);
  assert.equal(h.controller.state().active, true);
  await h.controller.dispose();
});

test("only GPU rendering is accepted and capability revocation disposes the active surface", async () => {
  const h = harness();
  assert.throws(() => h.controller.setMode("svg"), /Only GPU rendering/u);
  await h.update("A");
  await h.update("A", { capable: false });
  assert.equal(h.controller.state().status, "unavailable");
  assert.equal(h.controller.state().active, false);
  assert.equal(h.controller.state().fallback, false);
  assert.equal(h.count("dispose"), 1);
  await h.update("A", { capable: true });
  assert.equal(h.controller.state().active, true);
  assert.equal(h.count("create"), 2);
  await h.controller.dispose();
});

test("live content revisions reuse one surface and coalesce stale asynchronous scenes", async () => {
  const scene = deferred(), h = harness({ setScene: (_design, id) => {
    if (h.count("setScene") === 1) return scene.promise;
  } });
  const first = h.update("A");
  await turn();
  const second = h.update("A", { revision: 2, design: design("Edited A") });
  assert.equal(h.controller.state().active, false);
  scene.resolve();
  await Promise.all([first, second]);
  assert.equal(h.count("create"), 1);
  assert.equal(h.count("dispose"), 0);
  assert.deepEqual(h.calls.filter(([method]) => method === "setScene").map((call) => call[2].name),
    ["A", "Edited A"]);
  assert.equal(h.count("render"), 1);
  assert.equal(h.controller.state().revision, 2);
  assert.ok(h.states.filter((state) => state.active).every((state) => state.revision === 2));
  for (let revision = 3; revision < 9; revision += 1)
    await h.update("A", { revision, design: design(`Edit ${revision}`) });
  assert.equal(h.count("create"), 1);
  assert.equal(h.count("dispose"), 0);
  assert.equal(h.count("setScene"), 8);
  assert.equal(h.resources, 8);
  await h.update("B");
  assert.equal(h.count("dispose"), 1);
  assert.equal(h.count("create"), 2);
  await h.controller.dispose();
});

test("a same-key revision arriving during factory creation reuses the returned surface", async () => {
  const create = deferred(), h = harness({ create: () => create.promise });
  const first = h.update("A");
  await turn();
  const latest = h.update("A", { revision: 2, design: design("Latest") });
  create.resolve();
  await Promise.all([first, latest]);
  assert.equal(h.count("create"), 1);
  assert.equal(h.count("dispose"), 0);
  assert.deepEqual(h.calls.filter(([method]) => method === "setScene").map((call) => call[2].name), ["Latest"]);
  assert.equal(h.controller.state().revision, 2);
  await h.controller.dispose();
});

test("failed resources for a new revision clear the old surface and retry the current revision", async () => {
  const h = harness();
  await h.update("A");
  let attempts = 0;
  await h.update("A", { revision: 2, getResources: () => {
    if (++attempts === 1) throw new Error("Updated resources unavailable");
    return new Map();
  } });
  assert.equal(h.controller.state().status, "error");
  assert.equal(h.controller.state().active, false);
  assert.equal(h.count("dispose"), 1);
  await h.controller.setMode("gpu");
  assert.equal(h.controller.state().active, true);
  assert.equal(h.controller.state().revision, 2);
  assert.equal(h.count("create"), 2);
  await h.controller.update({ design: null });
  assert.equal(h.controller.state().status, "loading");
  assert.equal(h.controller.state().active, false);
  assert.equal(h.count("dispose"), 2);
  await h.controller.dispose();
});

test("context loss reports error across document changes until GPU is explicitly retried", async () => {
  const h = harness();
  await h.update("A"); await h.controller.setMode("gpu");
  const event = new Event("webglcontextlost", { cancelable: true });
  h.canvas.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.controller.state().active, false);
  assert.equal(h.controller.state().reason, "context-lost");
  assert.equal(h.controller.state().status, "error");
  assert.equal(h.controller.state().fallback, false);
  await h.update("B");
  assert.equal(h.count("create"), 1);
  assert.equal(h.count("dispose"), 1);
  await h.controller.setMode("gpu");
  assert.equal(h.controller.state().active, true);
  assert.equal(h.controller.state().key, "workspace/page/B");
  assert.equal(h.count("create"), 2);
  // Immediate re-selection must also retire the lost instance before reuse.
  h.canvas.dispatchEvent(new Event("webglcontextlost"));
  await h.controller.setMode("gpu");
  assert.equal(h.count("create"), 3);
  assert.equal(h.count("dispose"), 2);
  await h.controller.dispose();
});

test("dispose during an asynchronous scene build never activates it and removes context listeners", async () => {
  const scene = deferred(), h = harness({ setScene: () => scene.promise });
  const enabled = h.update("A");
  await turn();
  const disposed = h.controller.dispose();
  assert.equal(h.controller.state().reason, "disposed");
  assert.equal(h.controller.state().status, "disposed");
  scene.resolve();
  await Promise.all([enabled, disposed]);
  assert.equal(h.count("render"), 0);
  assert.equal(h.count("dispose"), 1);
  const states = h.states.length;
  h.canvas.dispatchEvent(new Event("webglcontextlost"));
  await h.controller.render(view);
  await h.controller.setMode("gpu");
  await h.controller.dispose();
  assert.equal(h.states.length, states);
  assert.equal(h.count("dispose"), 1);
});

test("explicit browser surfaces require their own successful draw and ignore unrelated WebGL loss", async () => {
  const scene=deferred(), h=harness({options:{mode:"browser",capability:false},setScene:()=>scene.promise,
    create:instance=>{instance.geometry=()=>new Map([["A",{x:1,width:20}]]);instance.hitTest=()=>"A";}});
  const pending=h.update("A",{viewOptions:{hiddenNodeIds:["A"]}});await turn();
  assert.equal(h.controller.state().mode,"browser");assert.equal(h.controller.geometry(),null);assert.equal(h.controller.hitTest({x:1,y:1}),null);
  h.canvas.dispatchEvent(new Event("webglcontextlost"));scene.resolve();await pending;
  assert.equal(h.controller.state().active,true);assert.equal(h.controller.state().fallback,false);assert.equal(h.controller.hitTest({x:1,y:1}),"A");assert.equal(h.controller.geometry().get("A").width,20);
  assert.throws(()=>h.controller.setMode("gpu"),/Only browser/u);
  await h.controller.suspend("renderer-inactive");assert.equal(h.controller.geometry(),null);assert.equal(h.controller.hitTest({x:1,y:1}),null);
  await h.controller.dispose();assert.throws(()=>createRendererController({mode:"automatic"}),/Unknown explicit/u);
});

test("browser revision supersession cancels pending preparation before accepting the latest scene",async()=>{
  const pending=deferred();let cancellations=0;
  const h=harness({options:{mode:"browser"},setScene:snapshot=>snapshot.name==="A"?pending.promise:undefined,
    create:instance=>{instance.cancelPreparation=()=>{cancellations++;pending.resolve(false);};}});
  const old=h.update("A");await turn();assert.equal(h.count("setScene"),1);
  const fresh=h.update("A",{revision:2,design:design("B")});await Promise.all([old,fresh]);
  assert.equal(cancellations,1);assert.equal(h.count("create"),1);assert.equal(h.count("setScene"),2);assert.equal(h.count("render"),1);assert.equal(h.controller.state().revision,2);assert.equal(h.controller.state().active,true);
  await h.controller.dispose();
});

test("browser controller disposal retires an in-flight preparation without waiting for its original edge",async()=>{
  const pending=deferred();const h=harness({options:{mode:"browser"},setScene:()=>pending.promise,dispose:()=>pending.resolve(false)});
  const old=h.update("A");await turn();const disposed=h.controller.dispose();
  assert.equal(h.count("dispose"),1);await Promise.all([old,disposed]);assert.equal(h.count("render"),0);assert.equal(h.controller.state().reason,"disposed");
});
