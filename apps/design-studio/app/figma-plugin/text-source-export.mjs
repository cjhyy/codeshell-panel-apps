/** Read-only export staging. Private native references never enter saved JSON. */
import { captureBoundNativeTextRanges } from "./text-range-state.mjs";
import { nativeTextRangeSnapshot, MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES } from "../native-text-ranges-source.mjs";
import { completeNativeTextSource, hasReservedNativeTextMetadata, NATIVE_TEXT_IMPORT_HINT_KEY } from "../native-text-import.mjs";

const MAX_BYTES = 16 * 1024 * 1024;
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = (code, message) => { const error = Error(message); error.code = code; throw error; };
const utf8 = text => {
  let bytes = 0;
  for (const character of text) {
    const value = character.codePointAt(0);
    bytes += value < 128 ? 1 : value < 2048 ? 2 : value < 65536 ? 3 : 4;
  }
  return bytes;
};
function stable(value, seen = new Set(), depth = 0) {
  if (value === null || typeof value === "boolean" || typeof value === "string" ||
      typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (depth > 40 || typeof value !== "object" || seen.has(value) || !Array.isArray(value) && !plain(value))
    fail("NATIVE_TEXT_EXPORT_DATA", "Source export requires complete owned JSON");
  const descriptors = Object.getOwnPropertyDescriptors(value), array = Array.isArray(value);
  const keys = Reflect.ownKeys(descriptors).filter(key => !array || key !== "length");
  if (keys.some(key => typeof key !== "string" || !Object.hasOwn(descriptors[key], "value") || !descriptors[key].enumerable) ||
      array && (keys.length !== value.length || keys.some((key, index) => key !== String(index))))
    fail("NATIVE_TEXT_EXPORT_DATA", "Source export cannot interpret hidden/accessor/sparse data");
  seen.add(value);
  const result = array ? "[" + keys.map(key => stable(descriptors[key].value, seen, depth + 1)).join(",") + "]" :
    "{" + keys.sort().map(key => JSON.stringify(key) + ":" + stable(descriptors[key].value, seen, depth + 1)).join(",") + "}";
  seen.delete(value);
  if (utf8(result) > MAX_BYTES) fail("NATIVE_TEXT_EXPORT_BUDGET", "Complete export exceeds16MiB");
  return result;
}

/** Fields that can independently cause a preview stay separate from text metrics. */
export function nativeTextExportPreviewContext(node, mixed) {
  const observed = value => value === mixed ? { mixed: true } : value ?? null;
  return stable({
    type: node.type, isMask: node.isMask === true, blendMode: node.blendMode ?? null,
    fills: observed(node.fills), strokes: observed(node.strokes), effects: observed(node.effects),
    mixedFontName: node.fontName === mixed, mixedFontSize: node.fontSize === mixed,
    childMasks: Array.isArray(node.children) ? node.children.map(child => [child.id, child.isMask === true]) : [],
  });
}

/**
 * Initial official REST remains the binding basis. The final synchronous check
 * proves complete observed SDK text/context fields, not atomic freshness of
 * arbitrary REST-only unknown properties or the complete document.
 */
export function createNativeTextExportCapture({ roots, mixed, pluginId } = {}) {
  if (!Array.isArray(roots) || roots.length > 10000 || new Set(roots).size !== roots.length || typeof mixed !== "symbol")
    fail("NATIVE_TEXT_EXPORT_CONTEXT", "Export capture requires exact current native roots and mixed identity");
  const entries = new Map(), warnings = [], nativeRoots = new Set(roots);
  const baselineContexts = new Map(), baselineChildren = new Map();
  let sourceBytes = 0, visited = 0, contextBytes = 0;
  const childrenOf = (node, cache) => {
    if (!node) return { values: [], indices: new Map() };
    if (!cache.has(node)) {
      const values = Array.isArray(node.children) ? [...node.children] : [], indices = new Map();
      for (const [index, child] of values.entries()) {
        if (indices.has(child)) fail("NATIVE_TEXT_EXPORT_TOPOLOGY", "Native children contain aliased objects");
        indices.set(child, index);
      }
      cache.set(node, { values, indices });
    }
    return cache.get(node);
  };
  const contextOf = (current, contexts, childrenCache) => {
    if (!contexts.has(current)) {
      const parent = current.parent, siblings = childrenOf(parent, childrenCache);
      const index = siblings.indices.get(current) ?? -1;
      if (parent && index < 0) fail("NATIVE_TEXT_EXPORT_TOPOLOGY", "Native source left its original parent");
      const context = nativeTextExportPreviewContext(current, mixed);
      if ((contextBytes += utf8(context)) > MAX_BYTES)
        fail("NATIVE_TEXT_EXPORT_BUDGET", "Complete native preview contexts exceed16MiB");
      contexts.set(current, { current, parent, id: current.id, index,
        children: childrenOf(current, childrenCache).values, context });
    }
    return contexts.get(current);
  };
  const lineage = (node, contexts = baselineContexts, childrenCache = baselineChildren) => {
    const result = [], seen = new Set(); let containsRoot = false;
    for (let current = node; current; current = current.parent) {
      if (seen.has(current) || result.length > 35 || current.removed === true)
        fail("NATIVE_TEXT_EXPORT_TOPOLOGY", "Native source identity or ancestry is unavailable");
      seen.add(current); if (nativeRoots.has(current)) containsRoot = true;
      result.push(contextOf(current, contexts, childrenCache));
    }
    if (!containsRoot) fail("NATIVE_TEXT_EXPORT_TOPOLOGY", "Native Text is outside the exported roots");
    return result;
  };
  const sameLineage = (before, after) => before.length === after.length && before.every((item, index) => {
    const current = after[index];
    return item.current === current.current && item.parent === current.parent && item.id === current.id &&
      item.index === current.index && item.context === current.context &&
      item.children.length === current.children.length && item.children.every((child, childIndex) => child === current.children[childIndex]);
  });
  const add = (rest, target, depth = 0) => {
    if (!plain(rest) || !target || target.id !== rest.id || depth > 34 || ++visited > 50000)
      fail("NATIVE_TEXT_EXPORT_IDENTITY", "Official REST and exact native source ownership disagree");
    if (rest.type !== (target.type === "PAGE" ? "CANVAS" : target.type))
      fail("NATIVE_TEXT_EXPORT_IDENTITY", "Official REST and native source types disagree");
    if (hasReservedNativeTextMetadata(rest))
      fail("NATIVE_TEXT_EXPORT_COLLISION", "Official REST contains a reserved supplemental lookalike; raw data was not overwritten");
    if (rest.children !== undefined && !Array.isArray(rest.children))
      fail("NATIVE_TEXT_EXPORT_DATA", "Official REST children must remain an array");
    if (target.type === "TEXT") {
      if (rest.type !== "TEXT" || rest.children?.length)
        fail("NATIVE_TEXT_EXPORT_IDENTITY", "Text source must remain a native leaf");
      const fingerprint = stable(rest), previous = entries.get(rest.id);
      if (previous) {
        if (previous.target !== target || previous.fingerprint !== fingerprint ||
            !sameLineage(previous.lineage, lineage(target)))
          fail("NATIVE_TEXT_EXPORT_OVERLAP", "Repeated Text source ownership or complete raw data disagree");
        return;
      }
      const captured = captureBoundNativeTextRanges(target, rest, mixed);
      const bound = captured.status === "bound" && completeNativeTextSource(captured.source);
      if (bound) {
        if (utf8(JSON.stringify({ rest, source: captured.source })) > MAX_NATIVE_TEXT_RANGE_SOURCE_BYTES)
          fail("NATIVE_TEXT_EXPORT_NODE_BUDGET", "The complete Text proof exceeds256KiB");
        sourceBytes += utf8(JSON.stringify(captured.source));
        if (sourceBytes > MAX_BYTES) fail("NATIVE_TEXT_EXPORT_BUDGET", "Complete native sources exceed16MiB");
      } else warnings.push(rest.id + ": complete native range source unavailable; existing fallback retained");
      entries.set(rest.id, { rest, target, fingerprint, lineage: lineage(target), bound,
        source: bound ? captured.source : undefined, snapshot: bound ? nativeTextRangeSnapshot(captured.source) : null });
      return;
    }
    const children = Array.isArray(target.children) ? target.children : [], index = new Map();
    for (const child of children) {
      if (index.has(child.id)) fail("NATIVE_TEXT_EXPORT_OVERLAP", "Native children contain repeated identity");
      index.set(child.id, child);
    }
    if ((rest.children ?? []).length !== children.length ||
        (rest.children ?? []).some((child, index) => child?.id !== children[index]?.id))
      fail("NATIVE_TEXT_EXPORT_IDENTITY", "Official and native child topology disagree");
    for (const child of rest.children ?? []) {
      const native = index.get(child?.id);
      if (!native) fail("NATIVE_TEXT_EXPORT_IDENTITY", "Official descendant has no exact native owner");
      add(child, native, depth + 1);
    }
  };
  const finalize = () => {
    const hints = new Map();
    const actualPluginId = typeof pluginId === "string" && /^[a-z0-9_.-]+$/iu.test(pluginId) ? pluginId : undefined;
    // Read optional metadata before the final complete SDK pass; no awaited
    // export, mutation, metadata read or image read follows that pass.
    for (const entry of entries.values()) if (entry.bound && actualPluginId && typeof entry.target.getPluginData === "function") {
      let hint;
      try { hint = entry.target.getPluginData(NATIVE_TEXT_IMPORT_HINT_KEY); }
      catch {
        warnings.push(entry.target.id + ": optional author hint unavailable; independent native source retained");
        continue;
      }
      if (typeof hint !== "string") fail("NATIVE_TEXT_EXPORT_HINT", "Native plugin data did not return a string");
      if (hint) {
        if (utf8(hint) + utf8(actualPluginId) + utf8(NATIVE_TEXT_IMPORT_HINT_KEY) > 100000)
          fail("NATIVE_TEXT_EXPORT_HINT_BUDGET", "The complete native plugin-data entry exceeds100000bytes");
        // Keep malformed/stale/over64KiB raw hints as bounded data. Import
        // restoration independently refuses them without erasing native intent.
        hints.set(entry.target.id, hint);
      }
    }
    const nodes = {}, finalContexts = new Map(), finalChildren = new Map();
    contextBytes = 0;
    for (const entry of entries.values()) {
      if (!sameLineage(entry.lineage, lineage(entry.target, finalContexts, finalChildren)) || stable(entry.rest) !== entry.fingerprint)
        fail("NATIVE_TEXT_EXPORT_RACE", "Native source identity/topology/preview cause changed during awaited export");
      const current = captureBoundNativeTextRanges(entry.target, entry.rest, mixed);
      const bound = current.status === "bound" && completeNativeTextSource(current.source);
      if (bound !== entry.bound || bound && nativeTextRangeSnapshot(current.source) !== entry.snapshot)
        fail("NATIVE_TEXT_EXPORT_RACE", "Complete observed native Text changed during awaited export");
      if (bound) Object.defineProperty(nodes, entry.target.id, { enumerable: true, configurable: true, writable: true,
        value: { source: current.source, ...(hints.has(entry.target.id) ? { hint: hints.get(entry.target.id) } : {}) } });
    }
    return { supplement: Object.keys(nodes).length ? { version: 1, ...(actualPluginId ? { pluginId: actualPluginId } : {}), nodes } : undefined,
      warnings, observedTextNodes: entries.size };
  };
  return { add, finalize };
}
