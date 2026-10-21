/** Inert node notes. These records never authorize layout, text or native writes. */
import { copyNativeTextEnvelope } from "./native-text-import.mjs";

export const NATIVE_NOTES_KEY = "codeshellNotes";
export const MAX_NATIVE_NOTE_BYTES = 16 * 1024;
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => own(value, key));
export const nativeNotesUtf8 = text => {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0);
    bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
  }
  return bytes;
};
const fail = (code, message) => { throw Object.assign(Error(message), { code }); };
export const validNativeNotesId = value => typeof value === "string" && value.length > 0 && value.length <= 160 &&
  !/[\u0000-\u001f\u007f]/u.test(value);

/** Missing entry is unknown. Empty SDK value means observed missing/cleared. */
export function nativeNotesObservation(value, pluginId) {
  if (typeof pluginId !== "string" || !/^[a-z0-9_.-]{1,256}$/iu.test(pluginId) || typeof value !== "string" || value.length > 2000 ||
      nativeNotesUtf8(pluginId) + nativeNotesUtf8(NATIVE_NOTES_KEY) + nativeNotesUtf8(value) > 100000)
    fail("NATIVE_NOTES_VALUE", "Native notes exceed the exact string or plugin-data entry budget");
  return value === "" ? { kind: "absent" } : { kind: "value", value };
}

export function normalizeNativeNotesSupplement(input) {
  if (input === undefined) return undefined;
  const value = copyNativeTextEnvelope(input);
  if (!exact(value, ["version", "pluginId", "nodes"]) || value.version !== 1 ||
      typeof value.pluginId !== "string" || !/^[a-z0-9_.-]{1,256}$/iu.test(value.pluginId) ||
      !plain(value.nodes) || Object.keys(value.nodes).length > 50000)
    fail("NATIVE_NOTES_TABLE", "Native notes require a bounded versioned metadata table");
  for (const [id, entry] of Object.entries(value.nodes)) {
    if (!validNativeNotesId(id) || !exact(entry, ["type", "notes"]) ||
        typeof entry.type !== "string" || !/^[A-Z][A-Z0-9_]{0,79}$/u.test(entry.type) ||
        !(exact(entry.notes, ["kind"]) && entry.notes.kind === "absent" ||
          exact(entry.notes, ["kind", "value"]) && entry.notes.kind === "value" &&
          typeof entry.notes.value === "string" && entry.notes.value.length > 0))
      fail("NATIVE_NOTES_ENTRY", "Native notes entry has invalid fields or absence semantics");
    nativeNotesObservation(entry.notes.kind === "value" ? entry.notes.value : "", value.pluginId);
    if (nativeNotesUtf8(JSON.stringify({ id, ...entry })) > MAX_NATIVE_NOTE_BYTES)
      fail("NATIVE_NOTES_ENTRY_BUDGET", "Complete native notes entry exceeds16KiB");
  }
  return value;
}

export function validateNativeNotesOwners(supplement, owners) {
  if (!supplement) return;
  for (const [id, entry] of Object.entries(supplement.nodes)) {
    if (owners.get(id)?.type !== entry.type)
      fail("NATIVE_NOTES_OWNER", "Native notes have no exact matching source ID/type");
    assertNativeNotesRawAgreement(owners.get(id), entry.notes, supplement.pluginId);
  }
}

/** Raw data can contradict an observation; it never supplies or authorizes one. */
export function assertNativeNotesRawAgreement(rest, notes, pluginId) {
  const field = (object, key) => {
    if (!plain(object)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor) return undefined;
    if (!own(descriptor, "value") || !descriptor.enumerable)
      fail("NATIVE_NOTES_RAW_CONFLICT", "Own-plugin raw notes must remain owned data");
    return descriptor.value;
  };
  const namespace = field(field(rest, "pluginData"), pluginId);
  if (!plain(namespace) || !own(namespace, NATIVE_NOTES_KEY)) return;
  const raw = field(namespace, NATIVE_NOTES_KEY), observed = notes.kind === "value" ? notes.value : "";
  if (typeof raw !== "string" || raw !== observed)
    fail("NATIVE_NOTES_RAW_CONFLICT", "Explicit own-plugin raw notes contradict the independent current observation");
}

/** Complete raw JSON comparison, including unknown metadata, without subtree strings. */
export function validateNativeNotesSource(supplement, roots) {
  if (!supplement) return;
  const owned = copyNativeTextEnvelope(roots), tokens = new Map(), fingerprints = new WeakMap();
  const intern = key => { if (!tokens.has(key)) tokens.set(key, tokens.size); return tokens.get(key); };
  const inspect = value => {
    if (value === null || typeof value !== "object") return intern("p" + JSON.stringify(value));
    const token = Array.isArray(value) ? intern("a" + JSON.stringify(value.map(inspect))) :
      intern("o" + JSON.stringify(Object.keys(value).sort().map(key => [key, inspect(value[key])])));
    fingerprints.set(value, token); return token;
  };
  inspect(owned);
  const owners = new Map(), locations = new Map(); let count = 0;
  const visit = (node, parent = null, index = null, depth = 0) => {
    if (!plain(node) || !validNativeNotesId(node.id) || depth > 34 || ++count > 50000 ||
        node.children !== undefined && !Array.isArray(node.children))
      fail("NATIVE_NOTES_SOURCE", "Notes require a bounded complete raw source tree");
    const previous = owners.get(node.id), location = locations.get(node.id);
    if (previous && fingerprints.get(previous) !== fingerprints.get(node) ||
        parent !== null && location && (location.parent !== parent || location.index !== index))
      fail("NATIVE_NOTES_SOURCE_CONFLICT", "Repeated raw notes source identity/content/location disagree");
    if (!previous) owners.set(node.id, node);
    if (parent !== null) locations.set(node.id, { parent, index });
    for (const [childIndex, child] of (node.children ?? []).entries()) visit(child, node.id, childIndex, depth + 1);
  };
  for (const root of owned) visit(root);
  validateNativeNotesOwners(supplement, owners);
}

export const notesSensitiveOperation = operation => operation.op === "delete" || operation.op === "delete-page" ||
  operation.op === "update" && operation.changed?.includes("notes");

/** Project only expected metadata; official operation.before is never rewritten. */
export function normalizeNativeNotesPatchBaseline(input) {
  if (input === undefined) return undefined;
  const value = copyNativeTextEnvelope(input), baseNodes = {};
  if (!exact(value, ["version", "pluginId", "nodes"]) || !plain(value.nodes))
    fail("NATIVE_NOTES_PATCH_BASELINE", "Notes patch requires an explicit complete metadata/catalog baseline");
  let links = 0;
  for (const [id, entry] of Object.entries(value.nodes)) {
    if (!exact(entry, ["type", "notes", "children"]) || !Array.isArray(entry.children) ||
        new Set(entry.children).size !== entry.children.length || entry.children.some(child => !validNativeNotesId(child)) ||
        (links += entry.children.length) > 50000)
      fail("NATIVE_NOTES_PATCH_BASELINE", "Notes patch child catalog is invalid or exceeds its budget");
    Object.defineProperty(baseNodes, id, { enumerable: true, configurable: true, writable: true,
      value: { type: entry.type, notes: entry.notes } });
  }
  normalizeNativeNotesSupplement({ version: value.version, pluginId: value.pluginId, nodes: baseNodes });
  for (const entry of Object.values(value.nodes))
    if (entry.children.some(id => !own(value.nodes, id)))
      fail("NATIVE_NOTES_PATCH_BASELINE", "Notes patch omits a catalog descendant");
  return value;
}

export function nativeNotesPatchBaseline(source, operations, sourceOwners) {
  if (!operations.some(notesSensitiveOperation)) return undefined;
  const baseline = normalizeNativeNotesSupplement(copyNativeTextEnvelope(source).nativeNotes);
  if (!baseline) fail("NATIVE_NOTES_BASELINE_REQUIRED", "Existing-node notes changes/deletions require a fresh native notes baseline");
  const nodes = {}, seen = new Set();
  const visit = (node, depth = 0) => {
    if (!plain(node) || !validNativeNotesId(node.id) || depth > 34 || seen.size >= 50000)
      fail("NATIVE_NOTES_BASELINE_REQUIRED", "Affected notes subtree is incomplete or exceeds its budget");
    const entry = baseline.nodes[node.id];
    if (!entry || entry.type !== node.type)
      fail("NATIVE_NOTES_BASELINE_REQUIRED", "Every affected source descendant requires an explicit notes observation");
    if (seen.has(node.id)) return;
    seen.add(node.id);
    Object.defineProperty(nodes, node.id, { value: { ...entry, children: (node.children ?? []).map(child => child.id) },
      enumerable: true, configurable: true, writable: true });
    for (const child of node.children ?? []) visit(child, depth + 1);
  };
  for (const operation of operations.filter(notesSensitiveOperation)) {
    visit(sourceOwners?.get(operation.sourceId) ?? operation.before);
  }
  return normalizeNativeNotesPatchBaseline({ version: 1, pluginId: baseline.pluginId, nodes });
}
