/** Read-only metadata snapshots and a deliberately synchronous notes-only commit. */
import { copyNativeTextEnvelope } from "../native-text-import.mjs";
import { NATIVE_NOTES_KEY, nativeNotesObservation, nativeNotesUtf8,
  normalizeNativeNotesSupplement, normalizeNativeNotesPatchBaseline, notesSensitiveOperation, validNativeNotesId } from "../native-notes.mjs";
import { assertNativeNotesRawAgreement } from "../native-notes.mjs";
import { isNativeExistingUpdateCapture } from "./existing-update-runtime.mjs";

const fail = (code, message) => { throw Object.assign(Error(message), { code }); };
const rawType = node => node.type === "PAGE" ? "CANVAS" : node.type;
const fingerprint = value => {
  const ordered = current => Array.isArray(current) ? current.map(ordered) : current !== null && typeof current === "object"
    ? Object.fromEntries(Object.keys(current).sort().map(key => [key, ordered(current[key])])) : current;
  return JSON.stringify(ordered(copyNativeTextEnvelope(value)));
};

function topologyCache() {
  const snapshots = new Map(); let references = 0;
  const snapshot = node => {
    if (!snapshots.has(node)) {
      if (!node || node.removed === true) fail("NATIVE_NOTES_IDENTITY", "Notes source was removed");
      const values = Array.isArray(node.children) ? node.children : [];
      if (!validNativeNotesId(node.id) || typeof node.type !== "string" || !/^[A-Z][A-Z0-9_]{0,79}$/u.test(node.type) ||
          values.length > 50000 || (references += values.length) > 100000)
        fail("NATIVE_NOTES_CONTEXT_BUDGET", "Native notes identity context exceeds its bounded catalog");
      const children = [...values];
      if (new Set(children).size !== children.length || new Set(children.map(child => child.id)).size !== children.length)
        fail("NATIVE_NOTES_IDENTITY", "Notes source children have duplicate identities");
      if (children.some(child => !validNativeNotesId(child?.id)))
        fail("NATIVE_NOTES_IDENTITY", "Notes source child has an invalid native ID");
      snapshots.set(node, { target: node, id: node.id, type: node.type, parent: node.parent, children,
        indices: new Map(children.map((child, index) => [child, index])) });
    }
    return snapshots.get(node);
  };
  const lineage = node => {
    const values = [], seen = new Set();
    for (let current = node; current; current = current.parent) {
      if (seen.has(current) || values.length > 35)
        fail("NATIVE_NOTES_IDENTITY", "Notes ancestry is cyclic or exceeds its budget");
      seen.add(current);
      const value = snapshot(current);
      if (value.parent && !snapshot(value.parent).indices.has(current))
        fail("NATIVE_NOTES_IDENTITY", "Notes source is no longer in its parent");
      values.push(value);
    }
    return values;
  };
  const assertCurrent = () => {
    for (const value of snapshots.values()) {
      const current = value.target, children = Array.isArray(current.children) ? current.children : [];
      if (current.removed === true || current.id !== value.id || current.type !== value.type ||
          current.parent !== value.parent || children.length !== value.children.length ||
          children.some((child, index) => child !== value.children[index]))
        fail("NATIVE_NOTES_RACE", "Notes source identity/topology changed during an awaited operation");
    }
  };
  return { lineage, assertCurrent };
}

function observe(node, pluginId) {
  let value;
  try {
    if (typeof node.getPluginData !== "function") throw Error();
    value = node.getPluginData(NATIVE_NOTES_KEY);
  } catch {
    fail("NATIVE_NOTES_UNAVAILABLE", "Current own-plugin notes getter is unavailable");
  }
  return nativeNotesObservation(value, pluginId);
}
const sameObservation = (first, second) => first.kind === second.kind && first.value === second.value;

export function createNativeNotesExportCapture({ roots, pluginId }) {
  if (typeof pluginId !== "string")
    fail("NATIVE_NOTES_CONTEXT", "Actual plugin identity is unavailable; current notes cannot be exported");
  normalizeNativeNotesSupplement({ version: 1, pluginId, nodes: {} });
  if (!Array.isArray(roots) || roots.length > 10000 || new Set(roots).size !== roots.length)
    fail("NATIVE_NOTES_CONTEXT", "Notes export requires exact current native roots");
  const nativeRoots = new Set(roots), entries = new Map(), rawRoots = [], topology = topologyCache();
  let visited = 0, sourceBytes = 0;
  const visit = (rest, target, depth = 0) => {
    if (!rest || typeof rest !== "object" || !target || rest.id !== target.id || rest.type !== rawType(target) ||
        depth > 34 || ++visited > 50000)
      fail("NATIVE_NOTES_IDENTITY", "Official source and current notes target disagree");
    const lineage = topology.lineage(target);
    if (!lineage.some(value => nativeRoots.has(value.target)))
      fail("NATIVE_NOTES_IDENTITY", "Notes target is outside the exported roots");
    const notes = observe(target, pluginId), previous = entries.get(rest.id);
    assertNativeNotesRawAgreement(rest, notes, pluginId);
    if (previous) {
      if (previous.target !== target || !sameObservation(previous.notes, notes) || fingerprint(previous.rest) !== fingerprint(rest))
        fail("NATIVE_NOTES_OVERLAP", "Repeated notes source identity/raw data/metadata disagree");
      return;
    }
    entries.set(rest.id, { rest, target, type: rest.type, notes });
    const children = Array.isArray(target.children) ? target.children : [];
    if (rest.children !== undefined && !Array.isArray(rest.children) ||
        (rest.children ?? []).length !== children.length ||
        (rest.children ?? []).some((child, index) => child?.id !== children[index]?.id))
      fail("NATIVE_NOTES_IDENTITY", "Official source and current notes subtree disagree");
    for (const [index, child] of (rest.children ?? []).entries()) visit(child, children[index], depth + 1);
  };
  const add = (rest, target) => {
    const before = fingerprint(rest);
    if ((sourceBytes += nativeNotesUtf8(before)) > 16 * 1024 * 1024)
      fail("NATIVE_NOTES_BUDGET", "Complete official notes source exceeds16MiB");
    rawRoots.push({ rest, before });
    visit(rest, target);
  };
  const assertCurrent = () => {
    for (const entry of entries.values())
      if (!sameObservation(entry.notes, observe(entry.target, pluginId)))
        fail("NATIVE_NOTES_RACE", "Current native notes changed during awaited export");
    topology.assertCurrent();
    for (const root of rawRoots)
      if (fingerprint(root.rest) !== root.before)
        fail("NATIVE_NOTES_RACE", "Official notes source changed during export");
  };
  const finalize = () => {
    assertCurrent();
    const nodes = {};
    for (const [id, entry] of entries)
      Object.defineProperty(nodes, id, { enumerable: true, configurable: true, writable: true,
        value: { type: entry.type, notes: entry.notes } });
    return normalizeNativeNotesSupplement({ version: 1, pluginId, nodes });
  };
  return { add, finalize, assertCurrent };
}

/** Unsupported mixed asynchronous patches refuse before any original-node write. */
export function createNativeNotesPatchCapture({ patch, indexes, pluginId, existingUpdates }) {
  if (!patch.operations.some(notesSensitiveOperation)) return null;
  if (!isNativeExistingUpdateCapture(existingUpdates, patch) && patch.operations.some(operation => !(operation.op === "update" && operation.changed?.length === 1 &&
      operation.changed[0] === "notes" || operation.op === "delete" || operation.op === "delete-page")))
    fail("NATIVE_NOTES_ASYNC_PATCH", "Notes-sensitive patches currently require notes-only updates/deletions; mixed asynchronous operations are refused");
  const baseline = normalizeNativeNotesPatchBaseline(patch.nativeNotesBefore);
  if (!baseline || baseline.pluginId !== pluginId)
    fail("NATIVE_NOTES_BASELINE_REQUIRED", "Existing notes writes/deletions require a fresh matching own-plugin baseline");
  const topology = topologyCache(), captured = new Map(), operations = new Map(), corroborated = new Map();
  for (const operation of patch.operations.filter(notesSensitiveOperation)) {
    if (operations.has(operation.sourceId)) fail("NATIVE_NOTES_PATCH", "Notes patch repeats a target");
    operations.set(operation.sourceId, operation);
  }
  const visit = (id, target, depth = 0) => {
    const expected = baseline.nodes[id];
    if (!target || !expected || id !== target.id || expected.type !== rawType(target) ||
        depth > 34 || captured.size >= 50000)
      fail("NATIVE_NOTES_BASELINE_REQUIRED", "Every affected native descendant requires a matching notes baseline");
    const previous = captured.get(id);
    if (previous && previous.target !== target) fail("NATIVE_NOTES_IDENTITY", "Notes patch aliases a native target");
    topology.lineage(target);
    const current = observe(target, pluginId);
    if (!sameObservation(expected.notes, current))
      fail("NATIVE_NOTES_CONFLICT", "Notes changed in Figma; export the current source before replacing, clearing or deleting them");
    captured.set(id, { target, expected });
    const children = Array.isArray(target.children) ? target.children : [];
    if (children.length !== expected.children.length || children.some((child, index) => child.id !== expected.children[index]))
      fail("NATIVE_NOTES_IDENTITY", "Affected notes subtree topology no longer matches its source");
    for (const [index, childId] of expected.children.entries()) visit(childId, children[index], depth + 1);
  };
  const captureTarget = (id, target) => {
    const operation = operations.get(id);
    if (!operation) return;
    const mapped = indexes.mapping.get(operation.designId), original = indexes.baseline.get(operation.designId);
    if (operation.op === "delete-page" ? indexes.pageMappings.get(operation.designId)?.sourceId !== id :
        !mapped || mapped.sourceId !== id || !original)
      fail("NATIVE_NOTES_IDENTITY", "Notes metadata cannot replace the original source mapping/baseline");
    const expectedParent = mapped?.selectionRoot ? mapped.sourceParentId : original?.parentId
      ? indexes.sourceIds.get(original.parentId) : indexes.pageMappings.get(original?.pageId)?.sourceId;
    if (expectedParent && target.parent?.id !== expectedParent || operation.op === "delete-page" && target.parent?.type !== "DOCUMENT")
      fail("NATIVE_NOTES_IDENTITY", "Notes target moved outside its source parent");
    if (operation.op !== "delete-page" && !expectedParent)
      fail("NATIVE_NOTES_IDENTITY", "Notes target has no complete source parent context");
    if (operation.before?.id !== id || operation.before.type !== baseline.nodes[id]?.type)
      fail("NATIVE_NOTES_IDENTITY", "Notes catalog root does not match the original source snapshot");
    visit(id, target);
  };
  const corroborateOwnRest = (id, raw) => {
    if (!operations.has(id)) return;
    let rawVisits = 0;
    const field = (value, key) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        fail("NATIVE_NOTES_RAW_CONFLICT", "Current official notes source must be an owned record");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable))
        fail("NATIVE_NOTES_RAW_CONFLICT", "Current official notes source contains an accessor or hidden field");
      return descriptor?.value;
    };
    const inspect = (sourceId, rest, depth = 0) => {
      const entry = captured.get(sourceId);
      if (!entry || depth > 34 || ++rawVisits > 60000 ||
          field(rest, "id") !== sourceId || field(rest, "type") !== entry.expected.type)
        fail("NATIVE_NOTES_RAW_CONFLICT", "Current official notes source and captured native identity disagree");
      assertNativeNotesRawAgreement(rest, entry.expected.notes, pluginId);
      const children = field(rest, "children") ?? [];
      if (!Array.isArray(children) || children.length !== entry.expected.children.length)
        fail("NATIVE_NOTES_RAW_CONFLICT", "Current official notes subtree does not cover every captured descendant");
      const descriptors = Object.getOwnPropertyDescriptors(children);
      if (Reflect.ownKeys(descriptors).length !== children.length + 1)
        fail("NATIVE_NOTES_RAW_CONFLICT", "Current official notes child array is not dense owned data");
      for (const [index, childId] of entry.expected.children.entries()) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable)
          fail("NATIVE_NOTES_RAW_CONFLICT", "Current official notes child is not owned data");
        inspect(childId, descriptor.value, depth + 1);
      }
    };
    inspect(id, raw); corroborated.set(id, raw);
  };
  const assertCurrent = (complete = true) => {
    if (complete && [...operations.keys()].some(id => !captured.has(id)))
      fail("NATIVE_NOTES_IDENTITY", "Notes patch did not capture every original target");
    if (complete && Object.keys(baseline.nodes).some(id => !captured.has(id)))
      fail("NATIVE_NOTES_IDENTITY", "Notes patch contains an unrelated catalog record");
    if (complete && [...operations.keys()].some(id => !corroborated.has(id)))
      fail("NATIVE_NOTES_RAW_CONFLICT", "Every notes-sensitive target requires its own current official source");
    for (const entry of captured.values())
      if (!sameObservation(entry.expected.notes, observe(entry.target, pluginId)))
        fail("NATIVE_NOTES_CONFLICT", "Native notes changed after preflight; no notes were written");
    topology.assertCurrent();
    if (complete) for (const [id, raw] of corroborated) corroborateOwnRest(id, raw);
    for (const [id] of operations) {
      if (!captured.has(id)) continue;
      let depth = 0;
      for (let parent = captured.get(id).target.parent; parent; parent = parent.parent) {
        if (++depth > 35 || ["delete", "delete-page"].includes(operations.get(parent.id)?.op))
          fail("NATIVE_NOTES_IDENTITY", "Notes patch contains overlapping or cyclic deletion targets");
      }
    }
  };
  const assertApplied = () => {
    topology.assertCurrent();
    for (const [id, entry] of captured) {
      const operation = operations.get(id), value = operation?.op === "update" ? operation.after.notes ?? "" :
        entry.expected.notes.kind === "value" ? entry.expected.notes.value : "";
      if (!sameObservation(nativeNotesObservation(value, pluginId), observe(entry.target, pluginId)))
        fail("NATIVE_NOTES_READBACK", "Native notes readback differs from the exact prepared intent");
    }
  };
  return { captureTarget, corroborateOwnRest, assertCurrent, assertApplied };
}
