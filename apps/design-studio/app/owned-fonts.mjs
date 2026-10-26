// Only faces constructed here belong to this manager. Resource IDs/family names
// never authorize deletion from the shared document FontFaceSet.
import { inspectFontCapabilities, fontCapabilitiesFromDataUrl, fontFaceWeight } from "./font-capabilities.mjs";
import { parseDesignFontFamily } from "./font-family.mjs";

/** A named family used only later in a glyph chain keeps its authored CSS face. */
export function designFontResourceRoles(nodes = [], resources = []) {
  const roles = new Map(), fonts = resources.filter(resource => resource.kind === "font");
  const families = parts => {
    for (const [index, part] of (parts ?? []).entries()) {
      if (part.generic) continue;
      for (const resource of fonts) {
        if (resource.family.toLowerCase() !== part.name.toLowerCase()) continue;
        if (index === 0 || !roles.has(resource.id))
          roles.set(resource.id, index === 0 ? "selected" : "glyph-fallback");
      }
    }
  };
  for (const node of nodes) {
    if (node.type !== "text") continue;
    const selected = fonts.find(resource => resource.id === node.fontRef);
    if (selected) roles.set(selected.id, "selected");
    const base = parseDesignFontFamily(node.fontFamily);
    const overridden = selected && (!base || base[0].generic || base[0].name.toLowerCase() !== selected.family.toLowerCase());
    if (!overridden) families(base);
    for (const range of node.textRanges?.ranges ?? []) {
      if (range.fontFamily === undefined || overridden && range.fontFamily === node.fontFamily) continue;
      families(parseDesignFontFamily(range.fontFamily));
    }
  }
  return roles;
}

export function createOwnedFontManager({ fontSet, createFace } = {}) {
  let lifecycle = 0, revision = 0, suspended = false;
  let active = new Map();
  const installed = new Set();
  const operations = new WeakMap(), preparations = new WeakMap(), leases = new WeakMap();
  const stale = () => new Error("字体加载作用域已变化；旧操作已取消");
  function assertOperation(token) {
    const operation = operations.get(token);
    if (!operation || suspended || operation.lifecycle !== lifecycle || operation.revision !== revision)
      throw stale();
    operation.check();
    return operation;
  }
  function sameResource(entry, resource, role) {
    const a = entry.descriptor, b = resource.descriptor;
    return entry.role === role && entry.dataUrl === resource.dataUrl && a.id === b.id && a.sha256 === b.sha256 &&
      a.bytes === b.bytes && a.mime === b.mime && a.family === b.family &&
      a.weight === b.weight && a.style === b.style;
  }
  function add(face) {
    // Register ownership before add: a throwing implementation may have added it.
    installed.add(face);
    fontSet.add(face);
  }
  function remove(face) {
    fontSet.delete(face);
    installed.delete(face);
  }
  function activate(next) {
    const previous = active;
    const nextFaces = new Set([...next.values()].map((entry) => entry.face));
    const previousFaces = new Set([...previous.values()].map((entry) => entry.face));
    const nextOrder = [...nextFaces], previousOrder = [...previousFaces];
    const unchanged = nextOrder.length === previousOrder.length &&
      nextOrder.every((face, index) => face === previousOrder[index]);
    if (unchanged && installed.size === nextFaces.size &&
      nextOrder.every((face) => installed.has(face) && fontSet.has(face))) return;
    try {
      // CSS font selection observes insertion order for colliding faces. Reuse
      // exact decoded instances, but install them in the complete target order.
      for (const face of [...installed]) remove(face);
      for (const face of nextFaces) add(face);
      active = next;
    } catch (error) {
      const errors = [error];
      for (const face of [...installed]) {
        try { remove(face); } catch (failure) { errors.push(failure); }
      }
      for (const face of previousFaces) {
        try { add(face); } catch (failure) { errors.push(failure); }
      }
      active = previous;
      if (errors.length > 1) throw new AggregateError(errors, "字体替换及回滚失败");
      throw error;
    }
  }
  function empty({ invalidateLeases = false, suspend = false } = {}) {
    revision += 1;
    if (invalidateLeases) lifecycle += 1;
    if (suspend) suspended = true;
    // Continue exact-instance cleanup even if one removal throws.
    const errors = [];
    for (const face of [...installed]) { try { remove(face); } catch (error) { errors.push(error); } }
    active = new Map();
    if (errors.length) throw new AggregateError(errors, "无法释放设计字体");
  }
  return Object.freeze({
    begin(check = () => {}) {
      if (suspended) throw stale();
      const token = Object.freeze({});
      operations.set(token, { lifecycle, revision: ++revision, check });
      assertOperation(token);
      return token;
    },
    assertCurrent: assertOperation,
    async prepare(token, resources, { roles = new Map() } = {}) {
      assertOperation(token);
      let entries;
      try {
        entries = await Promise.all(resources.filter((resource) => resource.descriptor.kind === "font").map(async (resource) => {
          assertOperation(token);
          if (!createFace || !fontSet) return;
          const role = roles.get(resource.descriptor.id) === "glyph-fallback" ? "glyph-fallback" : "selected";
          const old = active.get(resource.descriptor.id);
          if (old && sameResource(old, resource, role)) return [resource.descriptor.id, old];
          const capabilities = resource.bytes ? inspectFontCapabilities(resource.bytes) : fontCapabilitiesFromDataUrl(resource.dataUrl);
          const face = createFace(resource.descriptor.family, `url(${resource.dataUrl})`, {
            weight: role === "glyph-fallback" ? String(resource.descriptor.weight ?? 400) : fontFaceWeight(capabilities, resource.descriptor), style: resource.descriptor.style,
          });
          await face.load();
          assertOperation(token);
          return [resource.descriptor.id, { descriptor: { ...resource.descriptor }, dataUrl: resource.dataUrl, role, face }];
        }));
        assertOperation(token);
      } catch (error) {
        // Invalidate this failed operation without cancelling a newer operation.
        if (operations.get(token)?.revision === revision) revision += 1;
        throw error;
      }
      const next = new Map(entries.filter(Boolean));
      const prepared = Object.freeze({});
      preparations.set(prepared, { token, next });
      return prepared;
    },
    commit(token, prepared) {
      assertOperation(token);
      const preparation = preparations.get(prepared);
      if (!preparation || preparation.token !== token) throw stale();
      activate(preparation.next);
      preparations.delete(prepared);
      revision += 1;
    },
    captureLease() {
      const lease = Object.freeze({});
      leases.set(lease, { lifecycle, entries: new Map(active) });
      return lease;
    },
    restoreLease(lease) {
      const saved = leases.get(lease);
      if (!saved || suspended || saved.lifecycle !== lifecycle) return false;
      revision += 1;
      activate(new Map(saved.entries));
      return true;
    },
    invalidatePending() { revision += 1; },
    clear() { empty(); },
    reset() { empty({ invalidateLeases: true }); },
    suspend() { empty({ invalidateLeases: true, suspend: true }); },
    resume() {
      if (!suspended) return false;
      suspended = false;
      revision += 1;
      return true;
    },
  });
}
