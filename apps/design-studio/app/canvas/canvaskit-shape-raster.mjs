import { authoredCornerRadii } from '../corner-radii.mjs';
import { designFillPaints } from '../paint.mjs';
import { hasDesignStroke } from '../stroke.mjs';

// Presentation-only AA for small rotated leaves. Author geometry, hit testing,
// SVG and HTML continue to use the document. The owner shares text's 64 MiB
// raster reservation and defers setDeviceSampling during camera gestures.
export function canvasKitShapeRasterEligible(node, { hasChildren = false } = {}) {
  const fills = designFillPaints(node);
  return !hasChildren && ['rectangle', 'frame', 'component'].includes(node.type) &&
    Number.isFinite(node.rotation) && node.rotation !== 0 &&
    [node.x, node.y, node.width, node.height].every(Number.isFinite) &&
    node.width > 0 && node.height > 0 && node.width <= 64 && node.height <= 64 &&
    !node.shadow && !node.shadowStack && !hasDesignStroke(node) &&
    !(node.strokeWidth > 0) && !node.strokeSides &&
    fills.length === 1 && fills[0].type === 'SOLID' &&
    /^#[a-f\d]{6}$/iu.test(fills[0].color) && Number.isFinite(fills[0].opacity) && fills[0].opacity > 0 && fills[0].opacity <= 1 &&
    authoredCornerRadii(node).every(radius => Number.isFinite(radius) && radius >= 0);
}

const pivotFor = (node, pivot) => pivot ?? { x: node.x + node.width / 2, y: node.y + node.height / 2 };
const geometryKey = candidate => JSON.stringify([candidate.node,
  pivotFor(candidate.node, candidate.pivot), candidate.chain ?? []]);
const phase = value => ((value % 1) + 1) % 1;
function rotationChain(candidate) {
  return [...(candidate.chain ?? []).map(item => item.node ? item : { node: item }),
    { node: candidate.node, pivot: candidate.pivot }].filter(item => item.node.rotation);
}
function transformedBounds(candidate) {
  const node = candidate.node, chain = rotationChain(candidate);
  const corners = [[node.x, node.y], [node.x + node.width, node.y],
    [node.x + node.width, node.y + node.height], [node.x, node.y + node.height]].map(([x, y]) => {
    // Canvas concatenates outer-to-inner; a point sees inner rotations first.
    for (const item of [...chain].reverse()) {
      const p = pivotFor(item.node, item.pivot), angle = item.node.rotation * Math.PI / 180;
      const dx = x - p.x, dy = y - p.y;
      x = p.x + Math.cos(angle) * dx - Math.sin(angle) * dy;
      y = p.y + Math.sin(angle) * dx + Math.cos(angle) * dy;
    }
    return { x, y };
  });
  const x = Math.min(...corners.map(point => point.x)), y = Math.min(...corners.map(point => point.y));
  return { x, y, width: Math.max(...corners.map(point => point.x)) - x,
    height: Math.max(...corners.map(point => point.y)) - y };
}

export function createCanvasKitShapeRaster({ CK, document, text }) {
  const cache = new Map();
  let candidates = new Map(), builds = 0, hits = 0, fallbackCount = 0, fallbacks = [], disposed = false,
    evictions = 0, lastClearReason = null;
  const release = id => {
    const entry = cache.get(id);
    if (!entry) return;
    entry.image.delete(); cache.delete(id); text.releaseShapeRaster(id);
  };
  const clear = (reason = 'scene-release') => {
    evictions += cache.size; lastClearReason = reason;
    for (const id of cache.keys()) release(id);
  };
  text.setShapeRasterRelease?.(() => clear('shared-text-budget'));
  const live = () => { if (disposed) throw Error('Shape raster cache is disposed'); };
  const signature = id => cache.get(id)?.key ?? null;
  function beginScene(next = new Map()) {
    live();
    const entries = next instanceof Map ? [...next] : next.map(value => [value.node.id, value]);
    const accepted = new Map(entries.filter(([, value]) => canvasKitShapeRasterEligible(value.node,
      { hasChildren: value.hasChildren })));
    let changed = false;
    for (const [id, entry] of cache) {
      if (!accepted.has(id) || geometryKey(accepted.get(id)) !== entry.geometry) { release(id); changed = true; }
    }
    candidates = accepted;
    return changed;
  }
  function setDeviceSampling(visible = candidates, { scale = 1, pan = { x: 0, y: 0 } } = {}) {
    live();
    if (![scale, pan.x, pan.y].every(Number.isFinite) || scale <= 0)
      throw Error('Invalid device-shape sampling transform');
    const before = JSON.stringify([...cache].map(([id, entry]) => [id, entry.key]));
    const visibleIds = visible instanceof Map ? new Set(visible.keys()) :
      new Set([...visible].map(value => typeof value === 'string' ? value : value.node?.id ?? value.id));
    fallbacks = [];
    // Offscreen images are released; each eligible leaf owns at most one image.
    for (const id of cache.keys()) if (!visibleIds.has(id)) release(id);
    for (const id of visibleIds) {
      const candidate = candidates.get(id);
      if (!candidate) continue;
      const geometry = geometryKey(candidate), key = JSON.stringify([geometry, scale, phase(pan.x), phase(pan.y)]);
      if (cache.get(id)?.key === key) { hits++; continue; }
      release(id);
      const bounds = transformedBounds(candidate), left = Math.floor(bounds.x * scale + pan.x) - 2,
        top = Math.floor(bounds.y * scale + pan.y) - 2,
        width = Math.ceil((bounds.x + bounds.width) * scale + pan.x) + 2 - left,
        height = Math.ceil((bounds.y + bounds.height) * scale + pan.y) + 2 - top;
      const fallback = reason => { fallbackCount++; fallbacks.push({ nodeId: id, scale, reason }); };
      if (width > 8192 || height > 8192 || !Number.isSafeInteger(width * height) ||
          !text.reserveShapeRaster(id, width * height)) { fallback('shape-shared-raster-budget'); continue; }
      let image;
      try {
        const raster = document.createElement('canvas'); raster.width = width; raster.height = height;
        const context = raster.getContext('2d', { willReadFrequently: true });
        if (!context?.roundRect) throw Error('Canvas2D.roundRect unavailable');
        context.setTransform(scale, 0, 0, scale, pan.x - left, pan.y - top);
        for (const item of rotationChain(candidate)) {
          const p = pivotFor(item.node, item.pivot);
          context.translate(p.x, p.y); context.rotate(item.node.rotation * Math.PI / 180); context.translate(-p.x, -p.y);
        }
        const fill = designFillPaints(candidate.node)[0], node = candidate.node;
        context.fillStyle = fill.color; context.globalAlpha = fill.opacity;
        context.beginPath(); context.roundRect(node.x, node.y, node.width, node.height, authoredCornerRadii(node)); context.fill();
        image = CK.MakeImage({ width, height, colorType: CK.ColorType.RGBA_8888,
          alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB },
        context.getImageData(0, 0, width, height).data, width * 4);
        if (!image) throw Error('Cannot create GPU shape raster');
        cache.set(id, { image, key, geometry, pixels: width * height,
          x: (left - pan.x) / scale, y: (top - pan.y) / scale,
          width: width / scale, height: height / scale });
        image = null; builds++;
      } catch (error) {
        image?.delete(); text.releaseShapeRaster(id);
        fallback(`shape-raster-unavailable: ${String(error.message).slice(0, 120)}`);
      }
    }
    return before !== JSON.stringify([...cache].map(([id, entry]) => [id, entry.key]));
  }
  function draw(canvas, node) {
    const entry = cache.get(node.id);
    if (!entry) return false;
    const paint = new CK.Paint();
    try {
      canvas.drawImageRectOptions(entry.image, CK.XYWHRect(0, 0, entry.image.width(), entry.image.height()),
        CK.XYWHRect(entry.x, entry.y, entry.width, entry.height), CK.FilterMode.Nearest, CK.MipmapMode.None, paint);
    } finally { paint.delete(); }
    return true;
  }
  return { beginScene, setDeviceSampling, draw, signature, clear,
    hasDeviceSampling: () => cache.size > 0,
    isDeviceSamplingForNode: id => cache.has(typeof id === 'string' ? id : id.id),
    stats: () => ({ shapeRasterCandidates: candidates.size, shapeRasterImages: cache.size,
      shapeRasterPixels: [...cache.values()].reduce((sum, entry) => sum + entry.pixels, 0),
      shapeRasterBuilds: builds, shapeRasterHits: hits, shapeRasterEvictions: evictions,
      shapeRasterLastClearReason: lastClearReason, shapeRasterFallbackCount: fallbackCount,
      shapeRasterFallbacks: fallbacks.map(entry => ({ ...entry })) }),
    dispose() { if (disposed) return; clear('dispose'); text.setShapeRasterRelease?.(null); candidates.clear(); disposed = true; } };
}
