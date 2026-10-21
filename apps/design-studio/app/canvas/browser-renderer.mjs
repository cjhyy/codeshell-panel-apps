import { renderDesignFrontendPage, designFrontendCss } from "../frontend-export.mjs";
import { createDesignRuntimeFontFamily, designTextFontResourceIds } from "../font-css.mjs";
import { inertDesignSvg } from "../design-node-adapter.mjs";
import { insideRoundedRect } from "../corner-radii.mjs";
import { normalizeDesignResources, normalizeDesignResourceDescriptor } from "../resource-store.mjs";

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_NODES = 10000;
let sequence = 0;
const surfaces = new WeakMap();
const finite = value => typeof value === "number" && Number.isFinite(value);
const assert = (condition, message) => { if (!condition) throw Error(message); };
function dataUrl(bytes, mime, window) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:${mime};base64,${window.btoa(binary)}`;
}
function ownedAssets(design, resources, window) {
  assert(resources instanceof Map, "Browser renderer resources must be a Map");
  const descriptors = new Map(normalizeDesignResources(design.resources ?? []).map(resource => [resource.id, resource]));
  const assets = new Map(); let total = 0;
  for (const [id, resource] of resources) {
    assert(resource?.bytes instanceof window.Uint8Array && typeof id === "string", "Browser renderer needs owned local asset bytes");
    const canonical = descriptors.get(id), descriptor = normalizeDesignResourceDescriptor(structuredClone(resource.descriptor ?? canonical));
    assert(descriptor?.id === id && canonical && JSON.stringify(canonical) === JSON.stringify(descriptor), "Browser asset is missing its exact canonical descriptor");
    const mime = resource.mimeType ?? descriptor.mime;
    assert(mime === descriptor.mime && resource.bytes.byteLength === descriptor.bytes, "Browser asset MIME or length disagrees with its canonical descriptor");
    total += resource.bytes.byteLength;
    assert(total <= MAX_BYTES, "Browser scene assets exceed 16 MiB");
    const bytes = new window.Uint8Array(resource.bytes);
    if (mime === "image/svg+xml") inertDesignSvg(new window.TextDecoder("utf-8", {fatal:true}).decode(bytes));
    assets.set(id, { descriptor, bytes, mime });
  }
  return assets;
}
function sceneNodes(design) {
  const nodes = design.nodes;
  assert(Array.isArray(nodes) && nodes.length <= MAX_NODES, "Browser renderer needs a bounded normalized flat scene");
  const ids = new Set();
  for (const node of nodes) { assert(node && typeof node.id === "string" && !ids.has(node.id), "Browser scene IDs must be unique"); ids.add(node.id); }
  return nodes;
}

/** A canonical editable scene rendered by native browser Flex/Grid layout. */
export function createBrowserRenderer({ container, document = container?.ownerDocument } = {}) {
  assert(container && document?.body && container.ownerDocument === document, "Browser renderer needs its own live surface element");
  const previousSurface = surfaces.get(container);
  assert(previousSurface ? !previousSurface.live : !container.shadowRoot && container.childNodes.length === 0, "Browser renderer surface must be empty and exclusively owned");
  const window = document.defaultView, root = previousSurface?.root ?? container.attachShadow({mode:"closed"});
  const surfaceOwner = {root,live:true}; surfaces.set(container,surfaceOwner);
  root.replaceChildren();
  const sharedStyle = document.createElement("style");
  const viewportElement = document.createElement("div"); viewportElement.className = "browser-viewport";
  root.append(sharedStyle, viewportElement);
  let disposed = false, generation = 0, current = null, world = null, faceList = [], geometry = new Map();
  const preparations = new Set();
  let view = { width:1,height:1,dpr:1,pan:{x:0,y:0},zoom:1 }, stats = { renderer:"browser", inputNodes:0, flowNodes:0, absoluteNodes:0, layoutReads:0, loadedFontResources:0 };
  const id = ++sequence;
  const styles = css => `:host{all:initial;position:absolute;inset:0;display:block;overflow:hidden;pointer-events:none}.browser-viewport{position:absolute;inset:0;overflow:hidden;pointer-events:none}.browser-world{position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:auto}.browser-world *{user-select:none}.cs-page{margin:0!important;overflow:visible!important}${css}`;
  const cleanupFaces = faces => { for (const face of faces) document.fonts.delete(face); };
  const alive = token => !disposed && token === generation;
  const cancelPreparation = () => {
    generation++;
    for (const preparation of preparations) {
      preparation.cancel(); preparation.host?.remove(); cleanupFaces(preparation.faces); preparation.faces.length=0;
    }
    preparations.clear();
  };

  async function setScene(input, {resources = new Map(), viewOptions = {}} = {}) {
    assert(!disposed, "Browser renderer was disposed");
    cancelPreparation();
    const token = generation, design = structuredClone(input), nodes = sceneNodes(design), assets = ownedAssets(design, resources, window);
    const pendingFaces = [], faces = new Map(), families = new Map(); let host;
    let cancel;
    const cancelled = new Promise((_,reject)=>{cancel=()=>reject(Error("Browser preparation was cancelled"));});
    const preparation={cancel,faces:pendingFaces,host:null}; preparations.add(preparation);
    const deadline = window.performance.now()+15000;
    const prepared = async (promise,label) => {
      let timer;
      try {
        return await Promise.race([promise,cancelled,new Promise((_,reject) => {
          timer=window.setTimeout(()=>reject(Error(`Browser ${label} preparation exceeded 15 seconds`)),Math.max(0,deadline-window.performance.now()));
        })]);
      } catch (error) { if (alive(token)) throw error; }
      finally { window.clearTimeout(timer); }
    };
    try {
      for (const asset of assets.values()) {
        const digestBytes = await prepared(window.crypto.subtle.digest("SHA-256",asset.bytes),"asset digest");
        if (!alive(token)) return false;
        const digest = [...new window.Uint8Array(digestBytes)].map(value=>value.toString(16).padStart(2,"0")).join("");
        assert(digest === asset.descriptor.sha256, "Browser asset bytes disagree with the canonical SHA-256");
      }
      for (const [resourceId, asset] of assets) {
        if (asset.descriptor.kind !== "font") continue;
        assert(faces.size < 32, "Browser font resource count exceeds 32");
        const descriptor = asset.descriptor, key = descriptor.family.toLowerCase();
        const fallbackAlias = families.get(key)?.alias ?? `csbr${id}-${token}-family-${families.size}`;
        // Give the browser the actual faces of each family, including nearest
        // weight/style selection and synthesis for later glyph fallbacks.
        const face = new window.FontFace(fallbackAlias, asset.bytes, {weight:String(descriptor.weight),style:descriptor.style ?? "normal"});
        await prepared(face.load(),"font"); if (!alive(token)) return false;
        pendingFaces.push(face); families.set(key,{name:descriptor.family,alias:fallbackAlias});
        const alias = `csbr${id}-${token}-resource-${faces.size}`;
        const selectedFace = new window.FontFace(alias, asset.bytes, {weight:"1 1000",style:descriptor.style ?? "normal"});
        await prepared(selectedFace.load(),"selected font"); if (!alive(token)) return false;
        pendingFaces.push(selectedFace);
        assert(pendingFaces.length <= 64, "Browser private font face count exceeds 64");
        faces.set(resourceId, {alias,descriptor});
      }
      if (!alive(token)) return false;
      for (const face of pendingFaces) document.fonts.add(face);
      const runtimeFontFamily = node => {
        for (const resourceId of designTextFontResourceIds(node,design.resources))
          assert(faces.has(resourceId), `Missing supplied named fallback font bytes for ${node.id}`);
        const selected = node.fontRef ? faces.get(node.fontRef) : null;
        if (node.fontRef) assert(selected, `Missing supplied font bytes for ${node.id}`);
        const aliases = [...families.values()];
        return createDesignRuntimeFontFamily(node.fontFamily, {aliases,...(selected ? {resourceFamily:selected.descriptor.family,resourceAlias:selected.alias} : {})});
      };
      const urls = new Map([...assets].map(([resourceId, asset]) => [resourceId, dataUrl(asset.bytes, asset.mime, window)]));
      const withoutFontRules = { ...design, resources:(design.resources ?? []).filter(resource => resource.kind !== "font") };
      const onRenderNode = (node,parent) => {
        if (node.type === "image") assert(assets.has(node.imageRef), `Missing owned image bytes for ${node.id}`);
        if (node.type !== "instance") return;
        const parentLayout = node.layoutPositioning === "absolute" ? "none" : parent?.layout;
        const inheritedStretch = parent?.alignItems === "stretch" && (!node.layoutAlignSelf || node.layoutAlignSelf === "auto") && ["horizontal","vertical","grid"].includes(parentLayout);
        const constrained = ["Horizontal","Vertical"].some(axis=>node[`constraint${axis}`] === "stretch") ||
          [["width","minWidth","maxWidth"],["height","minHeight","maxHeight"]].some(([size,min,max])=>(node[min]!==undefined && node[size]<node[min]) || (node[max]!==undefined && node[size]>node[max]));
        if ((node.layoutSizingHorizontal ?? "fixed") !== "fixed" || (node.layoutSizingVertical ?? "fixed") !== "fixed" || inheritedStretch || constrained) {
          const error=Error(`BROWSER_INSTANCE_SIZING_UNSUPPORTED: 浏览器画布暂不支持实例“${String(node.name ?? node.id).slice(0,120)}”的 Hug/Fill 或拉伸尺寸。请使用实际固定尺寸，或手动选择 CanvasKit；设计数据已保留。`);
          error.code="BROWSER_INSTANCE_SIZING_UNSUPPORTED";throw error;
        }
      };
      const css = styles(designFrontendCss(withoutFontRules, {resourceDataUrls:urls}));
      host = document.createElement("div");
      preparation.host=host;
      host.style.cssText = `all:initial;position:fixed;left:-100000px;top:0;width:${design.canvas.width}px;opacity:0;pointer-events:none;contain:layout style`;
      const staging = host.attachShadow({mode:"closed"}), style = document.createElement("style"), candidate = document.createElement("div");
      style.textContent = css; candidate.className = "browser-world"; candidate.style.width = `${design.canvas.width}px`; candidate.style.height = `${design.canvas.height}px`;
      candidate.innerHTML = renderDesignFrontendPage(design, {resourceDataUrls:urls,runtimeFontFamily,onRenderNode,renderBudget:{maxNodes:20000,maxBytes:16*1024*1024}});
      staging.append(style,candidate); document.body.append(host);
      for (const node of nodes) if (node.type === "image") assert(assets.has(node.imageRef), `Missing owned image bytes for ${node.id}`);
      for (const element of candidate.querySelectorAll('[data-codeshell-node-type="image"]'))
        assert(element.localName === "img", "A canonical component image is missing owned local bytes");
      const images = [...candidate.querySelectorAll("img")]; assert(images.length <= 10000, "Browser image expansion exceeds its decode budget");
      for (const image of images) {
        try { await prepared(image.decode(),"image decode"); }
        catch (cause) { if (!alive(token)) return false; throw Error("Browser image decoding failed; the canonical design was retained", {cause}); }
        if (!alive(token)) return false;
        assert(image.complete && image.naturalWidth > 0 && image.naturalHeight > 0, "Browser image has no decoded intrinsic dimensions");
      }
      // Force the real font/style request before waiting for FontFaceSet.ready.
      candidate.getBoundingClientRect(); await prepared(document.fonts.ready,"font layout");
      if (!alive(token)) return false;
      const measured = measure(candidate, nodes), nextStats = { renderer:"browser", inputNodes:nodes.length, flowNodes:0, absoluteNodes:0, layoutReads:measured.size, loadedFontResources:faces.size, loadedFontFaces:pendingFaces.length };
      const hiddenIds = viewOptions.hiddenNodeIds ?? [];
      assert(Array.isArray(hiddenIds) && hiddenIds.length <= MAX_NODES && hiddenIds.every(value => typeof value === "string" && measured.has(value)), "Invalid browser-only paint suppression");
      for (const nodeId of hiddenIds) measured.get(nodeId).element.style.visibility = "hidden";
      for (const element of candidate.querySelectorAll("[data-codeshell-id]")) if (measured.has(element.getAttribute("data-codeshell-id"))) {
        if (window.getComputedStyle(element).position === "absolute") nextStats.absoluteNodes++; else nextStats.flowNodes++;
      }
      if (!alive(token)) return false;
      const oldWorld = world, oldFaces = faceList;
      sharedStyle.textContent = css; viewportElement.replaceChildren(candidate); world = candidate;
      current = design; geometry = measured; stats = nextStats; faceList = pendingFaces.splice(0);
      applyView(); oldWorld?.remove(); cleanupFaces(oldFaces);
      return true;
    } finally { preparations.delete(preparation); host?.remove(); cleanupFaces(pendingFaces); }
  }

  function measure(candidate, nodes) {
    const result = new Map(), page = candidate.querySelector(".cs-page"), origin = page.getBoundingClientRect(), index = new Map(nodes.map(node => [node.id,node]));
    assert([origin.x,origin.y,origin.width,origin.height].every(finite), "Browser page geometry is not finite");
    for (const element of candidate.querySelectorAll("[data-codeshell-id]")) {
      const nodeId = element.getAttribute("data-codeshell-id"); if (!index.has(nodeId)) continue;
      assert(!result.has(nodeId), "Browser layout produced a duplicate canonical node");
      const box = element.getBoundingClientRect(), style = window.getComputedStyle(element);
      assert([box.x,box.y,box.width,box.height].every(finite), "Browser node geometry is not finite");
      let linear = new window.DOMMatrix();
      const ancestry = []; for (let parent = element; parent && parent !== candidate; parent = parent.parentElement) ancestry.unshift(parent);
      if (["hidden","collapse"].includes(style.visibility) || ancestry.some(parent=>window.getComputedStyle(parent).display === "none")) {
        result.set(nodeId,Object.freeze({id:nodeId,x:0,y:0,width:0,height:0,boxWidth:0,boxHeight:0,matrix:Object.freeze([1,0,0,1,0,0]),visible:false,position:style.position,display:style.display,...(index.get(nodeId).type === "text" ? {fontFamily:style.fontFamily} : {}),element}));
        continue;
      }
      for (const parent of ancestry) {
        const transform = window.getComputedStyle(parent).transform;
        if (transform !== "none") linear = linear.multiply(new window.DOMMatrix(transform));
      }
      assert(linear.is2D, "Browser node has an unsupported 3D transform");
      const width = Number.parseFloat(style.width), height = Number.parseFloat(style.height);
      assert([width,height].every(finite), "Browser node has an unresolved border-box size");
      const x = box.x-origin.x, y = box.y-origin.y;
      const matrix = [linear.a,linear.b,linear.c,linear.d,x-Math.min(0,linear.a*width,linear.c*height,linear.a*width+linear.c*height),y-Math.min(0,linear.b*width,linear.d*height,linear.b*width+linear.d*height)];
      result.set(nodeId, Object.freeze({id:nodeId,x,y,width:box.width,height:box.height,boxWidth:width,boxHeight:height,matrix:Object.freeze(matrix),visible:style.display!=="none"&&style.visibility!=="hidden",position:style.position,display:style.display,...(index.get(nodeId).type === "text" ? {fontFamily:style.fontFamily} : {}),element}));
    }
    for (const node of nodes) assert(result.has(node.id), `Browser scene did not retain canonical ID ${node.id}`);
    return result;
  }
  function applyView() {
    container.style.width = `${view.width}px`; container.style.height = `${view.height}px`;
    if (world) world.style.transform = `translate(${view.pan.x}px,${view.pan.y}px) scale(${view.zoom})`;
  }
  function resize(width,height,dpr=1) {
    assert(!disposed && [width,height,dpr].every(value => finite(value)&&value>0), "Invalid browser viewport");
    view = {...view,width,height,dpr}; applyView();
  }
  function render({pan=view.pan,zoom=view.zoom}={}) {
    assert(!disposed && finite(pan.x)&&finite(pan.y)&&finite(zoom)&&zoom>0, "Invalid browser world transform");
    view = {...view,pan:{...pan},zoom}; applyView();
  }
  function hitTest(point) {
    if (!world || !current || !finite(point?.x)||!finite(point?.y)) return null;
    const box = container.getBoundingClientRect(), x = box.left+view.pan.x+point.x*view.zoom, y = box.top+view.pan.y+point.y*view.zoom;
    for (const element of root.elementsFromPoint(x,y)) {
      for (let owner=element;owner&&owner!==world;owner=owner.parentElement) {
        const nodeId=owner.getAttribute?.("data-codeshell-id"); if(geometry.has(nodeId) && qualifiesHit(nodeId, point)) return nodeId;
      }
    }
    return null;
  }
  function qualifiesHit(nodeId, point) {
    const index = new Map(current.nodes.map(node => [node.id,node])), seen = new Set();
    const inside = node => {
      const box = geometry.get(node.id); if (!box?.visible || box.boxWidth <= 0 || box.boxHeight <= 0) return false;
      const inverse = new window.DOMMatrix(box.matrix).inverse();
      if (![inverse.a,inverse.b,inverse.c,inverse.d,inverse.e,inverse.f].every(finite)) return false;
      const local = new window.DOMPoint(point.x,point.y).matrixTransform(inverse), width = box.boxWidth, height = box.boxHeight;
      if (local.x < 0 || local.y < 0 || local.x > width || local.y > height) return false;
      if (node.type === "ellipse") return ((local.x-width/2)/(width/2))**2+((local.y-height/2)/(height/2))**2 <= 1;
      return insideRoundedRect({...node,x:0,y:0,width,height},{x:local.x,y:local.y});
    };
    let node = index.get(nodeId); if (!node || !inside(node)) return false;
    while (node.parentId && !seen.has(node.id)) {
      seen.add(node.id); node = index.get(node.parentId); if (!node) return false;
      if (node.visible === false || node.clipContent && !inside(node)) return false;
    }
    return !node.parentId;
  }
  return {setScene,resize,render,hitTest,cancelPreparation,stats:()=>({...stats}),geometry:()=>new Map([...geometry].map(([nodeId,value])=>[nodeId,{...value,matrix:[...value.matrix],element:undefined}])),
    dispose(){if(disposed)return;disposed=true;cancelPreparation();world?.remove();world=null;current=null;geometry.clear();cleanupFaces(faceList);faceList=[];root.replaceChildren();surfaceOwner.live=false;}};
}
