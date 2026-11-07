import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canvasKitShapeRasterEligible, createCanvasKitShapeRaster } from '../../../apps/design-studio/app/canvas/canvaskit-shape-raster.mjs';

const leaf = (extra = {}) => ({ id: 'leaf', type: 'rectangle', x: 10, y: 20, width: 4, height: 1,
  rotation: 40, cornerRadius: .49, fill: '#686e67', opacity: .4, stroke: 'transparent', strokeWidth: 0, ...extra });
function harness({ budget = 16 * 1024 * 1024, failImage = false } = {}) {
  const claims = new Map(), rasters = [], deleted = [], draws = [], released = [];
  let releaseAll;
  const text = { reserveShapeRaster(id, pixels) {
    const total = [...claims].reduce((sum, [other, value]) => sum + (other === id ? 0 : value), pixels);
    if (total > budget) return false; claims.set(id, pixels); return true;
  }, releaseShapeRaster(id) { claims.delete(id); released.push(id); }, setShapeRasterRelease(fn) { releaseAll = fn; } };
  const document = { createElement() { const trace = []; const raster = { trace,
    getContext: () => Object.fromEntries(['setTransform', 'translate', 'rotate', 'beginPath', 'roundRect', 'fill'].map(name =>
      [name, (...args) => trace.push([name, ...args])]).concat([['getImageData', (_x, _y, width, height) => ({ data: new Uint8Array(width * height * 4) })]])) };
    rasters.push(raster); return raster;
  } };
  class Paint { delete() {} }
  const CK = { Paint, ColorType: { RGBA_8888: 0 }, AlphaType: { Unpremul: 0 }, ColorSpace: { SRGB: 0 },
    FilterMode: { Nearest: 0 }, MipmapMode: { None: 0 }, XYWHRect: (...args) => args,
    MakeImage: ({ width, height }) => failImage ? null : ({ width: () => width, height: () => height, delete() { deleted.push([width, height]); } }) };
  const cache = createCanvasKitShapeRaster({ CK, document, text }), canvas = { drawImageRectOptions: (...args) => draws.push(args) };
  return { cache, canvas, claims, rasters, deleted, draws, released, evictForText: () => releaseAll?.() };
}

test('rotated shape raster scope excludes children, legacy strokes, gradients, shadows and large nodes', () => {
  assert(canvasKitShapeRasterEligible(leaf()));
  assert.equal(canvasKitShapeRasterEligible(leaf(), { hasChildren: true }), false);
  for (const extra of [{ rotation: 0 }, { type: 'ellipse' }, { width: 64.1 }, { height: 0 },
    { stroke: '#000000', strokeWidth: 1 }, { stroke: 'transparent', strokeWidth: 1 }, { strokeAlign: 'center' }, { shadow: {} }, { shadowStack: {} },
    { fillPaints: [{ type: 'GRADIENT_LINEAR', opacity: 1, stops: [] }] },
    { fillPaints: [{ type: 'SOLID', color: '#000000', opacity: 1 }, { type: 'SOLID', color: '#ffffff', opacity: 1 }] }])
    assert.equal(canvasKitShapeRasterEligible(leaf(extra)), false, JSON.stringify(extra));
});

test('device shape sampling preserves radius and rule-e pivot, reuses integer pan, replaces phase/zoom and releases', t => {
  const h = harness(), node = leaf(), original = structuredClone(node), pivot = { x: 12.09375, y: 20.5 }, candidate = { node, pivot };
  t.after(() => h.cache.dispose());
  h.cache.beginScene(new Map([[node.id, candidate]]));
  assert(h.cache.setDeviceSampling(new Map([[node.id, candidate]]), { scale: 1, pan: { x: 0, y: 0 } }));
  assert.equal(h.rasters.length, 1);
  assert.deepEqual(h.rasters[0].trace.filter(call => ['translate', 'rotate'].includes(call[0])),
    [['translate', pivot.x, pivot.y], ['rotate', 40 * Math.PI / 180], ['translate', -pivot.x, -pivot.y]]);
  assert.deepEqual(h.rasters[0].trace.find(call => call[0] === 'roundRect'),
    ['roundRect', 10, 20, 4, 1, [.49, .49, .49, .49]], 'authored radius is preserved before Canvas2D overlap scaling');
  assert(h.cache.draw(h.canvas, node));
  assert.equal(h.draws[0][3], 0, 'nearest sampling avoids a second AA filter');
  const initial = h.cache.signature(node.id);
  assert.equal(h.cache.setDeviceSampling(new Map([[node.id, candidate]]), { scale: 1, pan: { x: 3, y: -2 } }), false);
  assert.equal(h.cache.signature(node.id), initial);
  assert.equal(h.rasters.length, 1);
  assert(h.cache.setDeviceSampling(new Map([[node.id, candidate]]), { scale: 1, pan: { x: 3.25, y: -2 } }));
  assert.equal(h.rasters.length, 2); assert.equal(h.deleted.length, 1); assert.equal(h.claims.size, 1);
  assert(h.cache.setDeviceSampling(new Map([[node.id, candidate]]), { scale: 2, pan: { x: 6.5, y: -4 } }));
  assert.equal(h.rasters.length, 3); assert.equal(h.deleted.length, 2); assert.equal(h.claims.size, 1);
  assert.deepEqual(node, original, 'author geometry and opacity remain untouched');
  h.evictForText(); assert.equal(h.cache.hasDeviceSampling(), false); assert.equal(h.claims.size, 0);
  assert.equal(h.cache.stats().shapeRasterLastClearReason, 'shared-text-budget');
  assert.equal(h.cache.draw(h.canvas, node), false, 'shared text pressure falls back to normal vector drawing');
  h.cache.dispose(); assert.equal(h.claims.size, 0); assert.equal(h.deleted.length, 3);
});

test('shape admission uses the shared reservation, bounded allocation and releases failed images', t => {
  for (const options of [{ budget: 1 }, { failImage: true }]) {
    const h = harness(options), node = leaf(), candidate = { node };
    t.after(() => h.cache.dispose()); h.cache.beginScene([candidate]);
    assert.equal(h.cache.setDeviceSampling([candidate], { scale: 1 }), false);
    assert.equal(h.cache.draw(h.canvas, node), false); assert.equal(h.claims.size, 0);
    assert.equal(h.cache.stats().shapeRasterFallbackCount, 1);
  }
  const h = harness(), candidate = { node: leaf({ width: 64, height: 64 }) };
  t.after(() => h.cache.dispose()); h.cache.beginScene([candidate]);
  h.cache.setDeviceSampling([candidate], { scale: 10000 });
  assert.equal(h.rasters.length, 0, 'oversized variants never allocate a Canvas2D surface');
  assert.equal(h.claims.size, 0); assert.equal(h.cache.stats().shapeRasterFallbackCount, 1);
});

test('ancestor rotations are baked outer-to-inner once and scene removal retires the only image', t => {
  const h = harness(), node = leaf(), parent = leaf({ id: 'parent', x: 0, y: 0, width: 40, height: 40, rotation: -15 }),
    candidate = { node, pivot: { x: 12.09375, y: 20.5 }, chain: [{ node: parent, pivot: { x: 20, y: 20 } }] };
  t.after(() => h.cache.dispose()); h.cache.beginScene([candidate]); h.cache.setDeviceSampling([candidate]);
  assert.deepEqual(h.rasters[0].trace.filter(call => call[0] === 'rotate').map(call => call[1]),
    [-15 * Math.PI / 180, 40 * Math.PI / 180]);
  assert.equal(h.cache.beginScene([candidate]), false, 'unchanged scene retains exact device image');
  assert(h.cache.beginScene([])); assert.equal(h.claims.size, 0); assert.equal(h.deleted.length, 1);
});
